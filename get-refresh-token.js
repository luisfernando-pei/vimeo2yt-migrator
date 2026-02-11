/**
 * Gera refresh token do YouTube (uma vez).
 *
 * Passo a passo:
 * 1) No Google Cloud Console:
 *    - habilite YouTube Data API v3
 *    - crie OAuth Client (Desktop App ou Web)
 * 2) Preencha no env.qa ou exporte variáveis:
 *    YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REDIRECT_URI
 * 3) Rode:
 *    node get-refresh-token.js
 * 4) Abra a URL, autorize, cole o "code" aqui.
 * 5) Ele imprime o REFRESH TOKEN -> cole no env.qa/env.prod
 */

import readline from "node:readline";
import { google } from "googleapis";
import dotenv from "dotenv";

const envFile = process.env.NODE_ENV === "prod" ? ".env.prod" : ".env.qa";
dotenv.config({ path: envFile });

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in ${envFile}`);
  return v;
}

const clientId = must("YT_CLIENT_ID");
const clientSecret = must("YT_CLIENT_SECRET");
const redirectUri = must("YT_REDIRECT_URI");

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

// IMPORTANT: access_type=offline => refresh token
const scopes = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
];
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: scopes,
  prompt: "consent"
});

console.log("\nAbra essa URL no browser e autorize:");
console.log(authUrl);
console.log("\nDepois cole aqui o 'code' que o Google retornar.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("CODE: ", async (code) => {
  try {
    const { tokens } = await oauth2.getToken(code.trim());
    console.log("\nTOKENS:\n", tokens);

    if (tokens.refresh_token) {
      console.log("\n✅ REFRESH TOKEN (cole no env.qa/env.prod):\n");
      console.log(tokens.refresh_token);
    } else {
      console.log("\n⚠️ Não veio refresh_token. Tente de novo com prompt=consent e access_type=offline.");
    }
  } catch (e) {
    console.error("Erro ao trocar code por token:", e.message || e);
  } finally {
    rl.close();
  }
});