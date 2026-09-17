import dns from "node:dns/promises";
import net from "node:net";
import { UiAgentError } from "../utils/errors.js";

export interface ValidatedReferenceUrl { url: URL; addresses: string[] }

export async function validateExternalReferenceUrl(value: string): Promise<ValidatedReferenceUrl> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new UiAgentError("NETWORK_BLOCKED", "Reference URL must use HTTP or HTTPS.");
  if (url.username || url.password) throw new UiAgentError("NETWORK_BLOCKED", "Credentials in reference URLs are forbidden.");
  if (url.port && !["80", "443"].includes(url.port)) throw new UiAgentError("NETWORK_BLOCKED", "Reference URLs may use only ports 80 or 443.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new UiAgentError("NETWORK_BLOCKED", "Local and internal reference hosts are forbidden.");
  const records = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => !isPublicAddress(record.address))) throw new UiAgentError("NETWORK_BLOCKED", `Reference host resolves to a private or reserved address: ${hostname}`);
  return { url, addresses: records.map((record) => record.address) };
}

export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    return true;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff") || normalized.startsWith("2001:db8:") || normalized.startsWith("2001:10:") || normalized.startsWith("2001:2:") || normalized.startsWith("100:") || normalized.startsWith("64:ff9b:1:")) return false;
    if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
    return true;
  }
  return false;
}

export function isAllowedPreviewUrl(candidate: string, previewOrigin: string): boolean {
  const url = new URL(candidate);
  if (["data:", "blob:", "about:"].includes(url.protocol)) return true;
  return url.origin === new URL(previewOrigin).origin;
}
