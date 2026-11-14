import crypto from "node:crypto";
import http from "node:http";

import { ipcMain, shell } from "electron";

/**
 * Inicio de sesion con Google desde el escritorio.
 *
 * Google rechaza el inicio de sesion dentro de navegadores embebidos (como
 * esta app), asi que se hace en el navegador del sistema: se abre la pagina de
 * Google, y Google devuelve el resultado a un servidor local temporal
 * (http://localhost:PUERTO/callback). Ese servidor solo existe mientras dura
 * el inicio de sesion y solo acepta un resultado con el "state" y el "nonce"
 * generados aqui.
 *
 * Requisito: en Google Cloud Console, el cliente OAuth web debe tener como
 * "URI de redireccionamiento autorizado" exactamente REDIRECT_URI.
 */

const PORT = 43817;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const TIMEOUT_MS = 3 * 60 * 1000;
const CLIENT_ID_RE = /^[\w.-]+\.apps\.googleusercontent\.com$/;

type Result = { idToken?: string; error?: string };

let cancelActive: (() => void) | undefined;

const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>StarknetChat</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:1.4rem}p{opacity:.7}</style></head><body><div>
<h1 id="t">Terminando el inicio de sesion...</h1><p id="p"></p></div>
<script>
(function(){
  var params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  fetch("/token", {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body: params.toString()})
    .then(function(r){ return r.json(); })
    .then(function(r){
      document.getElementById("t").textContent = r.ok ? "Listo, ya puede volver a StarknetChat" : "No se pudo iniciar sesion";
      document.getElementById("p").textContent = r.ok ? "Puede cerrar esta pestana." : (r.error || "");
    })
    .catch(function(){ document.getElementById("t").textContent = "No se pudo iniciar sesion"; });
  history.replaceState(null, "", "/callback");
})();
</script></body></html>`;

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const part = token.split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function signIn(clientId: string): Promise<Result> {
  cancelActive?.();

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");

  return new Promise<Result>((resolve) => {
    const servers: http.Server[] = [];
    let finished = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: Result) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (cancelActive === cancel) cancelActive = undefined;
      // Se deja un instante para responder a la pagina antes de cerrar
      setTimeout(() => servers.forEach((s) => s.close()), 500);
      resolve(result);
    };
    const cancel = () => finish({ error: "cancelado" });
    cancelActive = cancel;

    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);

      if (req.method === "GET" && url.pathname === "/callback") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(PAGE);
        return;
      }

      if (req.method === "POST" && url.pathname === "/token") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 16 * 1024) req.destroy();
        });
        req.on("end", () => {
          const reply = (payload: object) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
          };
          const params = new URLSearchParams(body);

          if (params.get("state") !== state) {
            reply({ ok: false, error: "Peticion no reconocida" });
            return;
          }
          const error = params.get("error");
          if (error) {
            reply({ ok: false, error });
            finish({ error });
            return;
          }
          const idToken = params.get("id_token") ?? "";
          const payload = decodeJwtPayload(idToken);
          if (!payload || payload.nonce !== nonce || payload.aud !== clientId) {
            reply({ ok: false, error: "Respuesta de Google no valida" });
            finish({ error: "respuesta no valida" });
            return;
          }
          reply({ ok: true });
          finish({ idToken });
        });
        return;
      }

      res.writeHead(404);
      res.end();
    };

    let listening = 0;
    const onListening = () => {
      listening++;
      if (listening === 1) {
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.searchParams.set("client_id", clientId);
        auth.searchParams.set("redirect_uri", REDIRECT_URI);
        auth.searchParams.set("response_type", "id_token");
        auth.searchParams.set("scope", "openid email profile");
        auth.searchParams.set("nonce", nonce);
        auth.searchParams.set("state", state);
        auth.searchParams.set("prompt", "select_account");
        void shell.openExternal(auth.toString());
        timer = setTimeout(() => finish({ error: "tiempo agotado" }), TIMEOUT_MS);
      }
    };

    // "localhost" puede resolver a IPv4 o IPv6: se escucha en las dos
    for (const host of ["127.0.0.1", "::1"]) {
      const server = http.createServer(handler);
      server.on("error", (err: NodeJS.ErrnoException) => {
        // IPv6 puede no estar disponible; solo es fatal si no hay ninguno
        if (host === "127.0.0.1") {
          finish({
            error:
              err.code === "EADDRINUSE"
                ? "El puerto local esta ocupado"
                : String(err.message),
          });
        }
      });
      server.listen(PORT, host, onListening);
      servers.push(server);
    }
  });
}

export function initGoogleAuth() {
  ipcMain.handle("googleSignIn", async (_event, clientId: unknown): Promise<Result> => {
    if (typeof clientId !== "string" || !CLIENT_ID_RE.test(clientId)) {
      return { error: "client_id no valido" };
    }
    return signIn(clientId);
  });
}
