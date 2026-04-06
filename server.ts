import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import cors from "cors";
import nodemailer from "nodemailer";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import * as dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  // Gmail Transporter
  const gmailTransporter = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD 
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      })
    : null;

  const getOAuth2Client = () => {
    const redirectUri = process.env.APP_URL?.endsWith("/") 
      ? `${process.env.APP_URL}auth/callback` 
      : `${process.env.APP_URL}/auth/callback`;
      
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  };

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: "GOOGLE_CLIENT_ID is not configured in environment variables." });
    }
    const oauth2Client = getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
      prompt: "consent",
    });
    res.json({ url });
  });

  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send("No code provided.");
    }
    
    try {
      const oauth2Client = getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code as string);
      
      // Still set cookie as fallback
      res.cookie("google_tokens", JSON.stringify(tokens), {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
      });

      res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center;">
            <div style="padding: 20px; border-radius: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534;">
              <h2 style="margin-top: 0;">Authentication Successful!</h2>
              <p>You can close this window now.</p>
              <button onclick="window.close()" style="background: #166534; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold;">Close Window</button>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS',
                  tokens: ${JSON.stringify(tokens)}
                }, '*');
                setTimeout(() => window.close(), 1000);
              }
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("OAuth error:", error);
      res.status(500).send("Authentication failed. Please check your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    }
  });

  app.get("/api/auth/status", (req, res) => {
    const tokens = req.cookies.google_tokens || req.query.tokens;
    res.json({ connected: !!tokens });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("google_tokens", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
    res.json({ success: true });
  });

  // Calendar API
  app.post("/api/calendar/invite", async (req, res) => {
    const { clientName, clientEmail, tokens: bodyTokens } = req.body;
    const tokensStr = bodyTokens ? JSON.stringify(bodyTokens) : req.cookies.google_tokens;

    if (!tokensStr) {
      return res.status(401).json({ error: "Google Calendar not connected." });
    }

    const eventId = process.env.GOOGLE_CALENDAR_EVENT_ID;
    if (!eventId || eventId === "your-event-id") {
      return res.status(400).json({ error: "GOOGLE_CALENDAR_EVENT_ID is not configured in environment variables." });
    }

    try {
      const tokens = JSON.parse(tokensStr);
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(tokens);

      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      
      // 1. Fetch existing event
      const existingEvent = await calendar.events.get({
        calendarId: "primary",
        eventId: eventId,
      });

      const attendees = existingEvent.data.attendees || [];
      
      // 2. Check if already added
      const alreadyAdded = attendees.some(a => a.email === clientEmail);
      if (alreadyAdded) {
        return res.json({ message: "Client is already a guest in the calendar event.", event: existingEvent.data });
      }

      // 3. Add new attendee
      attendees.push({ email: clientEmail, displayName: clientName });

      // 4. Update event
      const response = await calendar.events.update({
        calendarId: "primary",
        eventId: eventId,
        requestBody: {
          ...existingEvent.data,
          attendees: attendees,
        },
        sendUpdates: "all",
      });

      res.json({ message: "Client added to existing calendar event!", event: response.data });
    } catch (error: any) {
      console.error("Calendar error:", error);
      const errorMessage = error?.response?.data?.error?.message || error?.message || "Failed to update calendar event.";
      res.status(500).json({ error: errorMessage });
    }
  });

  // API routes
  app.get("/api/config", (req, res) => {
    res.json({
      gmailUser: process.env.GMAIL_USER || "marketing@xmonks.com"
    });
  });

  app.post("/api/send-email", async (req, res) => {
    const { clientName, clientEmail, companyName, isTest, variation } = req.body;

    if (!clientName || !clientEmail) {
      return res.status(400).json({ error: "Client name and email are required." });
    }

    const senderEmail = process.env.GMAIL_USER || "marketing@xmonks.com";
    const senderName = senderEmail.split('@')[0].split('.').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

    const subjectV1 = `Helping ${companyName || "[Company Name]"} Build Stronger Leaders | xMonks`;
    const subjectV2 = `Leadership Development at ${companyName || "[Company Name]"}, A Quick Thought | xMonks`;
    const subject = variation === 'v2' ? subjectV2 : subjectV1;
    const finalSubject = isTest ? `[TEST] ${subject}` : subject;

    const firstName = clientName ? clientName.split(" ")[0] : "[First Name]";

    const emailHtmlV1 = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>xMonks Outreach</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          <tr>
            <td style="background-color: #1e293b; padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">xMonks</h1>
              <p style="color: #94a3b8; margin: 10px 0 0 0; font-size: 16px;">Building Stronger Leaders</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 18px; color: #0f172a; font-weight: 600;">Hi ${firstName},</p>
              
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #334155;">I'll keep this brief, I know your inbox is busy.</p>
              
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                I'm <strong>${senderName.split(' ')[0]}</strong> from xMonks. We help HR and L&D leaders at organisations like <strong>Bosch, Flipkart, Tata Steel, and PUMA</strong> design leadership journeys that create real, measurable impact.
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 20px; border-radius: 0 8px 8px 0;">
                    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #9a3412;">
                      <strong>What sets us apart</strong> is an ecosystem approach that blends globally accredited coach training with customised interventions tailored to your organisation's specific leadership challenges, not a generic framework.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                I'd love to explore whether there's a fit with <strong>${companyName || "[Company Name]"}</strong>'s leadership agenda. Would you have 30 minutes available this week or next? Happy to work around your schedule.
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td align="center">
                    <a href="https://calendly.com/shubhankar-sethi-xmonks/30min" style="display: inline-block; background-color: #ea580c; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; text-align: center;">
                      Let's Connect for 30 Mins
                    </a>
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; padding-top: 30px;"></td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right: 15px;">
                    <p style="margin: 0 0 8px 0; font-size: 15px; color: #64748b;">Warm regards,</p>
                    <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 700; color: #0f172a;">${senderName}</p>
                    <p style="margin: 0 0 4px 0; font-size: 14px; color: #64748b;">xMonks Team</p>
                    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #ea580c;">xMonks</p>
                  </td>
                  <td width="50%" valign="top" style="padding-left: 15px; border-left: 1px solid #e2e8f0;">
                    <table border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-bottom: 8px; font-size: 14px; color: #475569;">
                          <span style="color: #ea580c; margin-right: 8px;">📞</span> +91-99991-99929
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 8px; font-size: 14px; color: #475569;">
                          <span style="color: #ea580c; margin-right: 8px;">✉️</span> <a href="mailto:${senderEmail}" style="color: #475569; text-decoration: none;">${senderEmail}</a>
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 14px; color: #475569;">
                          <span style="color: #ea580c; margin-right: 8px;">🌐</span> <a href="https://www.xmonks.com" style="color: #ea580c; text-decoration: none; font-weight: 600;">www.xmonks.com</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 30px; text-align: center;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #64748b;">
                      <strong>Included Resource:</strong>
                    </p>
                    <a href="https://xmonks.com/REDEFINE%20WHAT%E2%80%99S%20POSSIBLE%20-%20xMonks.pdf" style="display: inline-block; background-color: #ffffff; border: 2px solid #ea580c; color: #ea580c; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 6px;">
                      📄 View PDF Resource
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin-top: 20px;">
          <tr>
            <td align="center" style="font-size: 12px; color: #94a3b8; padding: 0 20px;">
              <p style="margin: 0;">© 2026 xMonks. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const emailHtmlV2 = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>xMonks Outreach</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          <tr>
            <td style="background-color: #1e293b; padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">xMonks</h1>
              <p style="color: #94a3b8; margin: 10px 0 0 0; font-size: 16px;">Building Stronger Leaders</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 18px; color: #0f172a; font-weight: 600;">Hi ${firstName},</p>
              
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                Most leadership programs focus on content delivery. The ones that actually shift behaviour do something different; they build the capability to lead, not just the knowledge of it.
              </p>
              
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                That's the core of what we do at xMonks. We partner with HR and L&D leaders to design leadership journeys that drive measurable change across teams, not just in the training room.
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 20px; border-radius: 0 8px 8px 0;">
                    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #9a3412;">
                      Organisations like <strong>Bosch, Tata Steel, Flipkart, PUMA, and ICICI Lombard</strong> have used our ecosystem approach, combining globally accredited coach training (Erickson, The Leadership Circle, David Clutterbuck/CMI) with bespoke interventions to strengthen leadership capability at scale.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                I'd love to learn about <strong>${companyName || "[Company Name]"}</strong>'s current leadership priorities and share how we might contribute. Would a 20-minute call this week or next work for you?
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 40px;">
                <tr>
                  <td align="center">
                    <a href="https://calendly.com/shubhankar-sethi-xmonks/30min" style="display: inline-block; background-color: #ea580c; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; text-align: center;">
                      Let's Connect for 20 Mins
                    </a>
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; padding-top: 30px;"></td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right: 15px;">
                    <p style="margin: 0 0 8px 0; font-size: 15px; color: #64748b;">Warm regards,</p>
                    <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 700; color: #0f172a;">${senderName}</p>
                    <p style="margin: 0 0 4px 0; font-size: 14px; color: #64748b;">Senior Manager - Business Development</p>
                    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #ea580c;">xMonks</p>
                  </td>
                  <td width="50%" valign="top" style="padding-left: 15px; border-left: 1px solid #e2e8f0;">
                    <table border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-bottom: 8px; font-size: 14px; color: #475569;">
                          <span style="color: #ea580c; margin-right: 8px;">📞</span> +91-99991-99929
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 8px; font-size: 14px; color: #475569;">
                          <span style="color: #ea580c; margin-right: 8px;">✉️</span> <a href="mailto:${senderEmail}" style="color: #475569; text-decoration: none;">${senderEmail}</a>
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 14px; color: #475569;">
                          <span style="color: #ea580c; margin-right: 8px;">🌐</span> <a href="https://www.xmonks.com" style="color: #ea580c; text-decoration: none; font-weight: 600;">www.xmonks.com</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 30px; text-align: center;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #64748b;">
                      <strong>Included Resource:</strong>
                    </p>
                    <a href="https://xmonks.com/REDEFINE%20WHAT%E2%80%99S%20POSSIBLE%20-%20xMonks.pdf" style="display: inline-block; background-color: #ffffff; border: 2px solid #ea580c; color: #ea580c; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 6px;">
                      📄 View PDF Resource
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin-top: 20px;">
          <tr>
            <td align="center" style="font-size: 12px; color: #94a3b8; padding: 0 20px;">
              <p style="margin: 0;">© 2026 xMonks. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const emailHtml = variation === 'v2' ? emailHtmlV2 : emailHtmlV1;

    try {
      // Try Gmail first if configured
      if (gmailTransporter) {
        await gmailTransporter.sendMail({
          from: `"${senderName}" <${senderEmail}>`,
          to: clientEmail,
          subject: finalSubject,
          html: emailHtml,
        });
        return res.status(200).json({ message: "Email sent successfully via Gmail!" });
      }

      // Fallback to Resend
      if (resend) {
        const { data, error } = await resend.emails.send({
          from: `${senderName} <${senderEmail}>`,
          to: [clientEmail],
          subject: finalSubject,
          html: emailHtml,
        });

        if (error) return res.status(400).json({ error });
        return res.status(200).json({ message: "Email sent successfully via Resend!", data });
      }

      return res.status(500).json({ 
        error: "No email service configured. Please set up GMAIL_USER/GMAIL_APP_PASSWORD or RESEND_API_KEY." 
      });

    } catch (err) {
      console.error("Email error:", err);
      res.status(500).json({ error: "Failed to send email. Check your credentials." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
