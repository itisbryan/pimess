import { spawn } from "node:child_process";
import { config, loadPhotonConfig, savePimessConfig } from "./config.mjs";

const DASHBOARD_HOST = (process.env.PHOTON_DASHBOARD_HOST || "https://app.photon.codes").replace(/\/$/, "");
const SPECTRUM_HOST = (process.env.PHOTON_SPECTRUM_HOST || "https://spectrum.photon.codes").replace(/\/$/, "");
const CLIENT_ID = "photon-cli";
const E164 = /^\+[1-9]\d{6,14}$/;

function basic(projectId, projectSecret) {
  return `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}`;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: "application/json", ...options.headers } });
  const text = await response.text();
  let value = {};
  try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text }; }
  if (!response.ok) {
    const detail = value?.message || value?.error || value?.detail || text || `HTTP ${response.status}`;
    throw new Error(`${response.status}: ${detail}`);
  }
  return value;
}

function listFrom(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
    if (Array.isArray(value?.data?.[key])) return value.data[key];
  }
  return Array.isArray(value?.data) ? value.data : [];
}

async function dashboard(path, token, options = {}) {
  return jsonRequest(`${DASHBOARD_HOST}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
  });
}

async function spectrum(path, projectId, projectSecret, options = {}) {
  return jsonRequest(`${SPECTRUM_HOST}${path}`, {
    ...options,
    headers: { authorization: basic(projectId, projectSecret), ...options.headers },
  });
}

async function deviceLogin({ openBrowser = true } = {}) {
  const code = await jsonRequest(`${DASHBOARD_HOST}/api/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "openid profile email" }),
  });
  const url = code.verification_uri_complete || code.verification_uri;
  console.log(`Open Photon to approve PiMess:\n${url}\nCode: ${code.user_code}`);
  if (openBrowser && process.platform === "darwin" && url) {
    const browser = spawn("open", [url], { stdio: "ignore", detached: true });
    browser.unref();
  }
  const deadline = Date.now() + Number(code.expires_in || 1800) * 1000;
  let delay = Number(code.interval || 5) * 1000;
  for (;;) {
    if (Date.now() >= deadline) throw new Error("Photon device login expired; run setup again");
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(`${DASHBOARD_HOST}/api/auth/device/token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.device_code,
        client_id: CLIENT_ID,
      }),
    });
    const value = await response.json().catch(() => ({}));
    if (response.ok && value.access_token) return value.access_token;
    if (value.error === "authorization_pending") continue;
    if (value.error === "slow_down") { delay += 5000; continue; }
    if (value.error) throw new Error(`Photon device login failed: ${value.error_description || value.error}`);
  }
}

async function projectFor(token, name, configuredId) {
  if (configuredId) {
    const projects = listFrom(await dashboard("/api/projects", token), ["projects"]);
    const found = projects.find((project) => project.id === configuredId);
    if (!found) throw new Error(`Photon project ${configuredId} is not available to this account`);
    return found;
  }
  const projects = listFrom(await dashboard("/api/projects", token), ["projects"]);
  const existing = projects.find((project) => String(project.name || "").toLowerCase() === name.toLowerCase());
  if (existing?.id) return existing;
  const created = await dashboard("/api/projects", token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, location: "United States", template: false, observability: false }),
  });
  const project = created.data && typeof created.data === "object" ? created.data : created;
  if (!project.id) throw new Error("Photon did not return a project id");
  return project;
}

async function provisionProjectSecret(token, projectId, existing) {
  if (existing) {
    try {
      await spectrum(`/projects/${projectId}/users/`, projectId, existing);
      return existing;
    } catch {}
  }
  const value = await dashboard(`/api/projects/${projectId}/regenerate-secret`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const secret = value.projectSecret || value.data?.projectSecret;
  if (!secret) throw new Error("Photon did not return a project secret");
  return secret;
}

async function registerPhone(projectId, secret, phone) {
  const current = listFrom(await spectrum(`/projects/${projectId}/users/`, projectId, secret), ["users"]);
  const found = current.find((user) => String(user.phoneNumber || "").replace(/[^\d+]/g, "") === phone);
  if (found) return { user: found, created: false };
  const value = await spectrum(`/projects/${projectId}/users/`, projectId, secret, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "shared", phoneNumber: phone }),
  });
  return { user: value.user || value.data || value, created: true };
}

async function assignedLine(token, projectId) {
  const value = await dashboard(`/api/projects/${projectId}/lines`, token);
  const lines = listFrom(value, ["lines"]);
  const existing = lines.find((line) => String(line.platform || "").toLowerCase() === "imessage");
  if (existing) return existing;
  const created = await dashboard(`/api/projects/${projectId}/lines`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "imessage" }),
  });
  return created.line || created.data || created;
}

export async function setupPhoton({ phone, projectName = "PiMess", projectId = null, projectSecret = null, photonConfigPath = config().photonConfigPath, openBrowser = true }) {
  if (!E164.test(phone)) throw new Error("--phone must be an E.164 number, e.g. +15551234567");
  const saved = loadPhotonConfig(photonConfigPath);
  let token = saved.dashboardToken;
  if (token) {
    try {
      await dashboard("/api/projects", token);
      console.log("[1/5] Using saved Photon dashboard login");
    } catch (error) {
      if (!/^(401|403):/.test(error.message)) throw error;
      token = null;
    }
  }
  if (!token) {
    console.log("[1/5] Photon device login");
    token = await deviceLogin({ openBrowser });
  }

  console.log("[2/5] Finding or creating project");
  const project = await projectFor(token, projectName, projectId || saved.projectId || null);
  const id = project.id;
  console.log(`[3/5] Provisioning Spectrum credentials for ${id}`);
  const secret = await provisionProjectSecret(token, id, projectSecret || saved.projectSecret || null);

  console.log(`[4/5] Registering ${phone}`);
  const registration = await registerPhone(id, secret, phone);
  const assigned = registration.user?.assignedPhoneNumber || (await assignedLine(token, id))?.phoneNumber || null;
  console.log(registration.created ? "  phone registered" : "  phone already registered");
  if (assigned) console.log(`  text this Photon line: ${assigned}`);
  else console.log("  no assigned line returned; check the Photon Dashboard");

  console.log("[5/5] Saving PiMess configuration");
  savePimessConfig(photonConfigPath, {
    projectId: id,
    projectSecret: secret,
    target: phone,
    dashboardToken: token,
    ...(assigned ? { assignedPhone: assigned } : {}),
  });
  console.log(`Photon setup complete: ${photonConfigPath}`);
  return { projectId: id, target: phone, assignedPhone: assigned, created: registration.created };
}

export function photonStatus(photonConfigPath = config().photonConfigPath) {
  const value = loadPhotonConfig(photonConfigPath);
  return {
    projectId: value.projectId || null,
    target: value.target || null,
    assignedPhone: value.assignedPhone || null,
    hasSecret: Boolean(value.projectSecret),
    hasDashboardToken: Boolean(value.dashboardToken),
  };
}
