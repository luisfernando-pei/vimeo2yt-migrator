import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config({ path: process.env.NODE_ENV === "prod" ? ".env.prod" : ".env.qa" });

const oauth2 = new google.auth.OAuth2(
  process.env.YT_CLIENT_ID,
  process.env.YT_CLIENT_SECRET,
  process.env.YT_REDIRECT_URI
);

oauth2.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });

const yt = google.youtube({ version: "v3", auth: oauth2 });

const res = await yt.channels.list({ part: ["snippet"], mine: true });
console.log(JSON.stringify(res.data, null, 2));