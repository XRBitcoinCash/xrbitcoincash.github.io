// xrpl-proxy/server.js — secure XRPL + Chat + Support Email proxy
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);

// ===== XRPL (no API key required) =====
const XRPL_RPC = "https://s1.ripple.com:51234";

// ===== OpenAI config (set in Render env) =====
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_BASE =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

// ===== Support email config (set in Render env) =====
const SUPPORT_EMAIL_USER = String(
  process.env.SUPPORT_EMAIL_USER || ""
).trim();

const SUPPORT_EMAIL_APP_PASSWORD = String(
  process.env.SUPPORT_EMAIL_APP_PASSWORD || ""
).replace(/\s+/g, "");

const SUPPORT_EMAIL_TO = String(
  process.env.SUPPORT_EMAIL_TO || SUPPORT_EMAIL_USER
).trim();

const SUPPORT_ALLOWED_ORIGINS = new Set(
  String(
    process.env.SUPPORT_ALLOWED_ORIGINS ||
      "https://xrbitcoincash.com,https://www.xrbitcoincash.com"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

// Maximum five support submissions per IP every 15 minutes.
const SUPPORT_RATE_WINDOW_MS = 15 * 60 * 1000;
const SUPPORT_RATE_MAX = 5;
const supportRateBuckets = new Map();

const SUPPORT_ISSUE_TYPES = new Set([
  "Page or interface problem",
  "Xaman connection or transaction request",
  "XRBC trustline or transaction",
  "Risk Lens, auditor, or analysis result",
  "Liquidity or market data",
  "Security concern",
  "XRBitcoin ecosystem",
  "General project question"
]);

let supportTransporter = null;

// ===== Middleware =====

// Preserve the existing public CORS behavior for XRPL and chat routes.
// The support route performs an additional strict origin check.
app.use(cors());

app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// ===== Shared helpers =====

async function xrplRpc(body) {
  const response = await axios.post(XRPL_RPC, body, {
    headers: {
      "Content-Type": "application/json"
    },
    timeout: 20000
  });

  return response.data;
}

function cleanText(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isReplyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

function isXHandle(value) {
  return /^@[A-Za-z0-9_]{1,15}$/.test(value);
}

function supportEmailConfigured() {
  return Boolean(
    SUPPORT_EMAIL_USER &&
      SUPPORT_EMAIL_APP_PASSWORD &&
      SUPPORT_EMAIL_TO
  );
}

function getSupportTransporter() {
  if (!supportEmailConfigured()) {
    return null;
  }

  if (!supportTransporter) {
    supportTransporter = nodemailer.createTransport({
      service: "gmail",
      pool: true,
      maxConnections: 1,
      maxMessages: 50,
      auth: {
        user: SUPPORT_EMAIL_USER,
        pass: SUPPORT_EMAIL_APP_PASSWORD
      },
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }

  return supportTransporter;
}

function supportOriginAllowed(req) {
  const origin = cleanText(req.get("origin"), 300);

  return Boolean(
    origin &&
      SUPPORT_ALLOWED_ORIGINS.has(origin)
  );
}

function supportRateLimit(req, res, next) {
  const now = Date.now();

  const ip = cleanText(
    req.ip ||
      req.socket?.remoteAddress ||
      "unknown",
    120
  );

  // Periodically remove expired entries.
  if (supportRateBuckets.size > 5000) {
    for (const [key, bucket] of supportRateBuckets.entries()) {
      if (now >= bucket.resetAt) {
        supportRateBuckets.delete(key);
      }
    }
  }

  const bucket = supportRateBuckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    supportRateBuckets.set(ip, {
      count: 1,
      resetAt: now + SUPPORT_RATE_WINDOW_MS
    });

    return next();
  }

  if (bucket.count >= SUPPORT_RATE_MAX) {
    res.set(
      "Retry-After",
      String(
        Math.ceil(
          (bucket.resetAt - now) / 1000
        )
      )
    );

    return res.status(429).json({
      ok: false,
      message:
        "Too many support requests. Please wait before trying again."
    });
  }

  bucket.count += 1;

  return next();
}

function validateSupportRequest(body) {
  const data = {
    issueType: cleanText(
      body?.issueType,
      90
    ),

    replyContact: cleanText(
      body?.replyContact,
      180
    ),

    pageName: cleanText(
      body?.pageName,
      160
    ),

    publicEvidence: cleanText(
      body?.publicEvidence,
      180
    ),

    problem: cleanText(
      body?.problem,
      5000
    ),

    website: cleanText(
      body?.website,
      200
    ),

    source: cleanText(
      body?.source,
      80
    ),

    pageUrl: cleanText(
      body?.pageUrl,
      500
    ),

    securityAcknowledged:
      body?.securityAcknowledged === true,

    formStartedAt:
      Number(body?.formStartedAt),

    submittedAt:
      Number(body?.submittedAt)
  };

  if (!SUPPORT_ISSUE_TYPES.has(data.issueType)) {
    throw new Error(
      "Choose a valid issue type."
    );
  }

  if (
    !data.replyContact ||
    (
      !isReplyEmail(data.replyContact) &&
      !isXHandle(data.replyContact)
    )
  ) {
    throw new Error(
      "Enter a valid reply email address or X handle."
    );
  }

  if (data.problem.length < 20) {
    throw new Error(
      "Describe the problem using at least 20 characters."
    );
  }

  if (!data.securityAcknowledged) {
    throw new Error(
      "The security acknowledgment is required."
    );
  }

  const now = Date.now();

  if (
    !Number.isFinite(data.formStartedAt) ||
    data.formStartedAt > now ||
    now - data.formStartedAt < 2000 ||
    now - data.formStartedAt >
      24 * 60 * 60 * 1000
  ) {
    throw new Error(
      "The form session could not be verified. Reload the page and try again."
    );
  }

  return data;
}

function makeSupportRequestId() {
  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  const random = crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return `XRBC-${date}-${random}`;
}

// ===== Health =====

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    supportEmailConfigured:
      supportEmailConfigured()
  });
});

// ===== Generic XRPL passthrough =====

app.post("/", async (req, res) => {
  try {
    const data = await xrplRpc(
      req.body
    );

    res.json(data);
  } catch (err) {
    console.error(
      "generic proxy error:",
      err?.response?.status,
      err?.message
    );

    res.status(502).json({
      error: "Proxy request failed",
      detail:
        err?.message ||
        String(err)
    });
  }
});

// ===== Ledger info =====

app.get(
  "/api/xrpl/ledger",
  async (_req, res) => {
    try {
      const data = await xrplRpc({
        method: "ledger",
        params: [
          {
            ledger_index: "validated"
          }
        ]
      });

      res.json(data);
    } catch (err) {
      console.error(
        "ledger error",
        err?.message || err
      );

      res.status(502).json({
        error: "Ledger fetch failed",
        detail:
          err?.message ||
          String(err)
      });
    }
  }
);

// ===== Account info =====

app.get(
  "/api/xrpl/account/:acct",
  async (req, res) => {
    try {
      const account =
        req.params.acct;

      const data = await xrplRpc({
        method: "account_info",
        params: [
          {
            account,
            ledger_index:
              "validated"
          }
        ]
      });

      res.json(data);
    } catch (err) {
      console.error(
        "account error",
        err?.message || err
      );

      res.status(502).json({
        error:
          "Account fetch failed",
        detail:
          err?.message ||
          String(err)
      });
    }
  }
);

// ===== XRBitcoinCash support email =====

app.post(
  "/api/support/email",
  supportRateLimit,
  async (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options":
        "nosniff"
    });

    if (!supportOriginAllowed(req)) {
      return res.status(403).json({
        ok: false,
        message:
          "This support endpoint only accepts requests from the official XRBitcoinCash website."
      });
    }

    const requestId =
      makeSupportRequestId();

    try {
      const data =
        validateSupportRequest(
          req.body
        );

      /*
       * Hidden spam honeypot.
       * Bots that fill this field receive
       * a neutral success response, but no
       * email is sent.
       */
      if (data.website) {
        return res.status(202).json({
          ok: true,
          requestId
        });
      }

      const transporter =
        getSupportTransporter();

      if (!transporter) {
        return res.status(503).json({
          ok: false,
          message:
            "The support email service is not configured yet."
        });
      }

      const subjectPage =
        data.pageName
          ? ` — ${data.pageName
              .replace(
                /[\r\n]+/g,
                " "
              )
              .slice(0, 80)}`
          : "";

      const subject =
        `[${requestId}] ` +
        `XRBitcoinCash Support — ` +
        `${data.issueType}` +
        `${subjectPage}`;

      const userAgent =
        cleanText(
          req.get("user-agent"),
          350
        ) || "Not supplied";

      const textBody = [
        "XRBitcoinCash Support Request",
        "==============================",
        "",
        `Reference: ${requestId}`,
        `Issue type: ${data.issueType}`,
        `Reply contact: ${data.replyContact}`,
        `Page or xApp: ${
          data.pageName ||
          "Not supplied"
        }`,
        `Transaction hash or public XRPL address: ${
          data.publicEvidence ||
          "Not supplied"
        }`,
        `Source page: ${
          data.pageUrl ||
          "Not supplied"
        }`,
        `Form source: ${
          data.source ||
          "Not supplied"
        }`,
        "",
        "Problem",
        "-------",
        data.problem,
        "",
        "Security acknowledgment: confirmed.",
        `Browser user agent: ${userAgent}`
      ].join("\n");

      const htmlBody = `
        <h2>XRBitcoinCash Support Request</h2>

        <p>
          <strong>Reference:</strong>
          ${escapeHtml(requestId)}
        </p>

        <table
          cellpadding="7"
          cellspacing="0"
          border="1"
          style="border-collapse:collapse"
        >
          <tr>
            <th align="left">
              Issue type
            </th>
            <td>
              ${escapeHtml(
                data.issueType
              )}
            </td>
          </tr>

          <tr>
            <th align="left">
              Reply contact
            </th>
            <td>
              ${escapeHtml(
                data.replyContact
              )}
            </td>
          </tr>

          <tr>
            <th align="left">
              Page or xApp
            </th>
            <td>
              ${escapeHtml(
                data.pageName ||
                  "Not supplied"
              )}
            </td>
          </tr>

          <tr>
            <th align="left">
              Public evidence
            </th>
            <td>
              ${escapeHtml(
                data.publicEvidence ||
                  "Not supplied"
              )}
            </td>
          </tr>

          <tr>
            <th align="left">
              Source page
            </th>
            <td>
              ${escapeHtml(
                data.pageUrl ||
                  "Not supplied"
              )}
            </td>
          </tr>

          <tr>
            <th align="left">
              Form source
            </th>
            <td>
              ${escapeHtml(
                data.source ||
                  "Not supplied"
              )}
            </td>
          </tr>
        </table>

        <h3>Problem</h3>

        <p style="white-space:pre-wrap">
          ${escapeHtml(data.problem)}
        </p>

        <p>
          <strong>
            Security acknowledgment:
          </strong>
          confirmed.
        </p>
      `;

      await transporter.sendMail({
        from:
          `"XRBitcoinCash Website Support" ` +
          `<${SUPPORT_EMAIL_USER}>`,

        to: SUPPORT_EMAIL_TO,

        replyTo:
          isReplyEmail(
            data.replyContact
          )
            ? data.replyContact
            : undefined,

        subject,

        text: textBody,

        html: htmlBody,

        headers: {
          "X-XRBC-Support-ID":
            requestId
        }
      });

      return res.status(200).json({
        ok: true,
        requestId
      });
    } catch (err) {
      const message = cleanText(
        err?.message ||
          "Unknown error",
        500
      );

      const isValidationError =
        /choose|enter|describe|required|verified|security acknowledgment/i.test(
          message
        );

      if (!isValidationError) {
        console.error(
          "[support email error]",
          {
            requestId,
            code:
              err?.code || "",
            responseCode:
              err?.responseCode ||
              "",
            message
          }
        );
      }

      return res
        .status(
          isValidationError
            ? 400
            : 500
        )
        .json({
          ok: false,
          message:
            isValidationError
              ? message
              : "The support request could not be delivered. Use the manual email fallback or try again later."
        });
    }
  }
);

// ===== Chat proxy =====

app.post(
  "/chat",
  async (req, res) => {
    try {
      const { messages } =
        req.body || {};

      if (
        !Array.isArray(messages) ||
        messages.length === 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "Missing or invalid messages array"
          });
      }

      if (!OPENAI_KEY) {
        return res
          .status(500)
          .json({
            error:
              "OpenAI key not configured on server"
          });
      }

      // Limit to last 10 messages for safety.
      const trimmed =
        messages.slice(-10);

      const payload = {
        model: OPENAI_MODEL,
        messages: trimmed,
        temperature: 0.6,
        max_tokens: 600
      };

      const response =
        await axios.post(
          `${OPENAI_BASE}/chat/completions`,
          payload,
          {
            headers: {
              Authorization:
                `Bearer ${OPENAI_KEY}`,
              "Content-Type":
                "application/json"
            },
            timeout: 30000,
            validateStatus:
              () => true
          }
        );

      if (response.status === 401) {
        return res
          .status(502)
          .json({
            error:
              "OpenAI auth failed (401)",
            detail:
              response.data
          });
      }

      if (response.status === 429) {
        return res
          .status(502)
          .json({
            error:
              "OpenAI rate limit / insufficient quota (429)",
            detail:
              response.data
          });
      }

      if (
        response.status < 200 ||
        response.status >= 300
      ) {
        console.error(
          "[OpenAI error]",
          response.status,
          response.data
        );

        return res
          .status(502)
          .json({
            error:
              "Upstream OpenAI error",
            status:
              response.status,
            detail:
              response.data
          });
      }

      if (
        !response.data ||
        typeof response.data !==
          "object"
      ) {
        return res
          .status(502)
          .json({
            error:
              "Invalid OpenAI response format"
          });
      }

      res.json(response.data);
    } catch (err) {
      console.error(
        "[chat proxy error]",
        err?.message || err
      );

      res.status(502).json({
        error:
          "Chat proxy request failed",
        detail:
          err?.message ||
          String(err)
      });
    }
  }
);

// ===== Environment check =====
// This route never returns password or API-key values.

app.get(
  "/env-check",
  (_req, res) => {
    res.json({
      hasOpenAIKey:
        Boolean(OPENAI_KEY),

      model:
        OPENAI_MODEL,

      hasSupportEmailUser:
        Boolean(
          SUPPORT_EMAIL_USER
        ),

      hasSupportEmailAppPassword:
        Boolean(
          SUPPORT_EMAIL_APP_PASSWORD
        ),

      hasSupportEmailDestination:
        Boolean(
          SUPPORT_EMAIL_TO
        ),

      supportEmailConfigured:
        supportEmailConfigured(),

      supportAllowedOrigins:
        Array.from(
          SUPPORT_ALLOWED_ORIGINS
        )
    });
  }
);

// ===== 404 fallback =====

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    method: req.method
  });
});

// ===== Boot log =====

function printRoutes() {
  const routes = [];
  const stack =
    app._router?.stack || [];

  stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push(
        `${Object.keys(
          middleware.route.methods
        )
          .join(",")
          .toUpperCase()} ${
          middleware.route.path
        }`
      );
    } else if (
      middleware.name ===
        "router" &&
      middleware.handle?.stack
    ) {
      middleware.handle.stack.forEach(
        (routeLayer) => {
          if (routeLayer.route) {
            routes.push(
              `${Object.keys(
                routeLayer.route
                  .methods
              )
                .join(",")
                .toUpperCase()} ${
                routeLayer.route.path
              }`
            );
          }
        }
      );
    }
  });

  console.log(
    "[ROUTES]",
    routes
  );
}

// ===== Start =====

app.listen(PORT, () => {
  console.log(
    `✅ XRBC Secure XRPL/Chat/Support proxy running on port ${PORT}`
  );

  console.log(
    `[SUPPORT EMAIL] configured=${supportEmailConfigured()} recipient=${
      SUPPORT_EMAIL_TO ||
      "not configured"
    }`
  );

  printRoutes();
});
