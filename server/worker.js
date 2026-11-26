// Spieleolympiade-Server: Cloudflare Worker + Durable Object (ein Raum pro Code)
import { DurableObject } from "cloudflare:workers";
import * as L from "./logic.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne I, O, 0, 1
const rnd = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const makeCode = () => Array.from(rnd(4), (b) => ALPHA[b % ALPHA.length]).join("");
const makeKey = () => Array.from(rnd(16), (b) => b.toString(16).padStart(2, "0")).join("");
const LIFETIME = 24 * 3600 * 1000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/ping") return json({ ok: true, t: Date.now() });

    if (url.pathname === "/room" && req.method === "POST") {
      const key = makeKey();
      for (let i = 0; i < 8; i++) {
        const code = makeCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const r = await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ key }) });
        if (r.status === 200) return json({ code, key });
      }
      return json({ error: "busy" }, 503);
    }

    const m = url.pathname.match(/^\/room\/([A-Z0-9]{4})\/ws$/);
    if (m && req.headers.get("Upgrade") === "websocket") {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(req);
    }
    return new Response("Spieleolympiade-Server läuft", { status: 200, headers: CORS });
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.st = null;
    this.hand = {};
    ctx.blockConcurrencyWhile(async () => {
      this.st = (await ctx.storage.get("st")) || null;
      const h = await ctx.storage.list({ prefix: "h:" });
      h.forEach((v, k) => { this.hand[k.slice(2)] = v; });
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      if (this.st) return new Response("exists", { status: 409 });
      const { key } = await req.json();
      this.st = L.newState(String(key), Date.now());
      await this.save();
      return new Response("ok");
    }
    if (!this.st) return new Response("Raum nicht gefunden", { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async save() {
    await this.ctx.storage.put("st", this.st);
    await this.ctx.storage.setAlarm(Date.now() + LIFETIME);
  }

  async clearHand() {
    const keys = Object.keys(this.hand).map((id) => "h:" + id);
    this.hand = {};
    if (keys.length) await this.ctx.storage.delete(keys);
  }

  async alarm() {
    this.getSockets().forEach((ws) => { try { ws.close(1000, "Raum abgelaufen"); } catch (e) {} });
    await this.ctx.storage.deleteAll();
    this.st = null;
  }

  getSockets() { return this.ctx.getWebSockets(); }
  att(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }
  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch (e) {} }

  onlineDevs() {
    const s = new Set();
    this.getSockets().forEach((ws) => { const a = this.att(ws); if (a.role === "player" && a.dev) s.add(a.dev); });
    return s;
  }

  broadcast() {
    if (!this.st) return;
    const online = this.onlineDevs();
    this.getSockets().forEach((ws) => {
      const a = this.att(ws);
      if (a.role === "host") this.send(ws, L.viewForHost(this.st, online, this.hand));
      else if (a.role === "player") this.send(ws, L.viewForPlayer(this.st, a.dev));
    });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 20000 || !this.st) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const now = Date.now();
    if (m.t === "ping") { this.send(ws, { t: "pong", c: m.c, s: now }); return; }

    let a = this.att(ws);
    if (m.t === "hello") {
      if (m.role === "host") {
        if (m.key !== this.st.hostKey) { this.send(ws, { t: "error", e: "key" }); return; }
        a = { role: "host" };
      } else {
        const dev = String(m.dev || "").slice(0, 40); if (!dev) return;
        a = { role: "player", dev };
      }
      ws.serializeAttachment(a);
      this.broadcast();
      return;
    }
    if (!a.role) return;

    let changed = false;
    if (a.role === "host") {
      switch (m.t) {
        case "roster": changed = L.setRoster(this.st, m.list); break;
        case "open": L.openRound(this.st, now); changed = true; break;
        case "lock": L.closeRound(this.st); changed = true; break;
        case "unlock": L.reopen(this.st); changed = true; break;
        case "reset": L.resetBuzz(this.st); changed = true; break;
        case "wrong": L.wrongNext(this.st); changed = true; break;
        case "markWrong": L.markWrong(this.st, Array.isArray(m.ids) ? m.ids.map(String) : []); changed = true; break;
        case "ask": { const ok = L.askQuestion(this.st, m.q, now); if (ok) { await this.clearHand(); changed = true; } else this.send(ws, { t: "error", e: "badq" }); break; }
        case "qlock": L.lockQuestion(this.st); changed = true; break;
        case "qopen": L.openQuestion(this.st); changed = true; break;
        case "qclear": L.clearQuestion(this.st); await this.clearHand(); changed = true; break;
        case "kick": delete this.st.claims[String(m.id)]; changed = true; break;
        case "end": await this.alarm(); return;
      }
    } else if (a.role === "player") {
      switch (m.t) {
        case "claim": { const r = L.claim(this.st, a.dev, String(m.id)); if (r !== "ok") this.send(ws, { t: "error", e: r }); changed = true; break; }
        case "guest": { const r = L.addGuest(this.st, a.dev, m.name); if (r !== "ok") this.send(ws, { t: "error", e: r }); changed = true; break; }
        case "release": L.release(this.st, a.dev); changed = true; break;
        case "answer": {
          const rid = L.ridOf(this.st, a.dev); if (!rid) break;
          const r = L.submitAnswer(this.st, rid, m.v);
          if (r === "hand") { this.hand[rid] = m.v; await this.ctx.storage.put("h:" + rid, m.v); changed = true; }
          else if (r === "ok") changed = true;
          else this.send(ws, { t: "error", e: "ans-" + r });
          break;
        }
        case "buzz": { const rid = L.ridOf(this.st, a.dev); if (rid) changed = L.buzz(this.st, rid, m.ts, now, m.rtt); break; }
      }
    }
    if (changed) { await this.save(); this.broadcast(); }
  }

  async webSocketClose(ws) { try { ws.close(); } catch (e) {} this.broadcast(); }
  async webSocketError(ws) { this.broadcast(); }
}
