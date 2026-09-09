// xrpl-proxy/server.js — secure XRPL + Chat + Resend Support Email proxy
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);

// ===== XRPL (no API key required) =====
const XRPL_RPC = "https://s1.ripple.com:51234";

// ===== OpenAI config (set in Render env) =====
const OPENAI_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(
  process.env.OPENAI_MODEL || "gpt-4o-mini"
).trim();

const OPENAI_BASE = String(
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
).replace(/\/+$/, "");

// ===== Resend support email config (set in Render env) =====
const RESEND_API_KEY = String(
  process.env.RESEND_API_KEY || ""
).trim();

const RESEND_API_URL = "https://api.resend.com/emails";

const SUPPORT_EMAIL_TO = String(
  process.env.SUPPORT_EMAIL_TO ||
    "xrbitcoincash@gmail.com"
).trim();

const SUPPORT_EMAIL_FROM = String(
  process.env.SUPPORT_EMAIL_FROM ||
    "XRBitcoinCash Support <support@xrbitcoincash.com>"
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

class SupportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SupportValidationError";
  }
}

// ===== Middleware =====

// Existing public CORS behavior is preserved for XRPL and chat.
// The support route also performs its own strict origin check.
app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// ===== Shared helpers =====

async function xrplRpc(body) {
  const response = await axios.post(
    XRPL_RPC,
    body,
    {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 20000
    }
  );

  return response.data;
}

function cleanText(value, maxLength) {
  return String(
    value == null
      ? ""
      : value
  )
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(
    value == null
      ? ""
      : value
  )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isReplyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(
    value
  );
}

function isXHandle(value) {
  return /^@[A-Za-z0-9_]{1,15}$/.test(
    value
  );
}

function supportEmailConfigured() {
  return Boolean(
    RESEND_API_KEY &&
      SUPPORT_EMAIL_TO &&
      SUPPORT_EMAIL_FROM
  );
}

function supportOriginAllowed(req) {
  const origin = cleanText(
    req.get("origin"),
    300
  );

  return Boolean(
    origin &&
      SUPPORT_ALLOWED_ORIGINS.has(origin)
  );
}

function supportRateLimit(
  req,
  res,
  next
) {
  const now = Date.now();

  const ip = cleanText(
    req.ip ||
      req.socket?.remoteAddress ||
      "unknown",
    120
  );

  if (
    supportRateBuckets.size >
    5000
  ) {
    for (
      const [
        key,
        bucket
      ] of supportRateBuckets.entries()
    ) {
      if (
        now >=
        bucket.resetAt
      ) {
        supportRateBuckets.delete(
          key
        );
      }
    }
  }

  const bucket =
    supportRateBuckets.get(ip);

  if (
    !bucket ||
    now >= bucket.resetAt
  ) {
    supportRateBuckets.set(
      ip,
      {
        count: 1,
        resetAt:
          now +
          SUPPORT_RATE_WINDOW_MS
      }
    );

    return next();
  }

  if (
    bucket.count >=
    SUPPORT_RATE_MAX
  ) {
    res.set(
      "Retry-After",
      String(
        Math.ceil(
          (
            bucket.resetAt -
            now
          ) / 1000
        )
      )
    );

    return res
      .status(429)
      .json({
        ok: false,
        message:
          "Too many support requests. Please wait before trying again."
      });
  }

  bucket.count += 1;

  return next();
}

function validateSupportRequest(
  body
) {
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
      body?.securityAcknowledged ===
      true,

    formStartedAt:
      Number(
        body?.formStartedAt
      ),

    submittedAt:
      Number(
        body?.submittedAt
      )
  };

  if (
    !SUPPORT_ISSUE_TYPES.has(
      data.issueType
    )
  ) {
    throw new SupportValidationError(
      "Choose a valid issue type."
    );
  }

  if (
    !data.replyContact ||
    (
      !isReplyEmail(
        data.replyContact
      ) &&
      !isXHandle(
        data.replyContact
      )
    )
  ) {
    throw new SupportValidationError(
      "Enter a valid reply email address or X handle."
    );
  }

  if (
    data.problem.length <
    20
  ) {
    throw new SupportValidationError(
      "Describe the problem using at least 20 characters."
    );
  }

  if (
    !data.securityAcknowledged
  ) {
    throw new SupportValidationError(
      "The security acknowledgment is required."
    );
  }

  const now = Date.now();

  if (
    !Number.isFinite(
      data.formStartedAt
    ) ||
    data.formStartedAt >
      now ||
    now -
      data.formStartedAt <
      2000 ||
    now -
      data.formStartedAt >
      24 *
        60 *
        60 *
        1000
  ) {
    throw new SupportValidationError(
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

  const random =
    crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();

  return `XRBC-${date}-${random}`;
}

function buildSupportEmail(
  data,
  requestId,
  userAgent
) {
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

  const text = [
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

  const html = `
    <h2>
      XRBitcoinCash Support Request
    </h2>

    <p>
      <strong>
        Reference:
      </strong>
      ${escapeHtml(
        requestId
      )}
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

    <h3>
      Problem
    </h3>

    <p style="white-space:pre-wrap">
      ${escapeHtml(
        data.problem
      )}
    </p>

    <p>
      <strong>
        Security acknowledgment:
      </strong>
      confirmed.
    </p>
  `;

  return {
    subject,
    text,
    html
  };
}

async function sendSupportEmailWithResend({
  data,
  requestId,
  subject,
  text,
  html
}) {
  const emailPayload = {
    from:
      SUPPORT_EMAIL_FROM,

    to: [
      SUPPORT_EMAIL_TO
    ],

    subject,

    text,

    html,

    headers: {
      "X-XRBC-Support-ID":
        requestId
    }
  };

  /*
   * When the user supplies an
   * email address, the Reply
   * button will answer that address.
   *
   * X handles remain visible in
   * the message body but are not
   * placed into reply_to.
   */
  if (
    isReplyEmail(
      data.replyContact
    )
  ) {
    emailPayload.reply_to =
      data.replyContact;
  }

  const response =
    await axios.post(
      RESEND_API_URL,
      emailPayload,
      {
        headers: {
          Authorization:
            `Bearer ${RESEND_API_KEY}`,

          "Content-Type":
            "application/json",

          "User-Agent":
            "XRBitcoinCash-Support/1.0",

          "Idempotency-Key":
            requestId
        },

        timeout:
          30000,

        validateStatus:
          () => true
      }
    );

  if (
    response.status <
      200 ||
    response.status >=
      300
  ) {
    const resendMessage =
      cleanText(
        response.data
          ?.message ||
          response.data
            ?.error ||
          `Resend returned HTTP ${response.status}.`,
        500
      );

    const error =
      new Error(
        resendMessage
      );

    error.code =
      cleanText(
        response.data
          ?.name ||
          response.data
            ?.code ||
          "RESEND_API_ERROR",
        100
      );

    error.responseCode =
      response.status;

    throw error;
  }

  const resendEmailId =
    cleanText(
      response.data?.id,
      200
    );

  if (!resendEmailId) {
    const error =
      new Error(
        "Resend accepted the request but did not return an email ID."
      );

    error.code =
      "INVALID_RESEND_RESPONSE";

    throw error;
  }

  return resendEmailId;
}

// ===== Health =====

app.get(
  "/healthz",
  (_req, res) => {
    res.json({
      ok: true,

      ts:
        Date.now(),

      supportEmailProvider:
        "resend",

      supportEmailConfigured:
        supportEmailConfigured()
    });
  }
);

// ===== Generic XRPL passthrough =====

app.post(
  "/",
  async (req, res) => {
    try {
      const data =
        await xrplRpc(
          req.body
        );

      res.json(data);
    } catch (err) {
      console.error(
        "generic proxy error:",
        err?.response
          ?.status,
        err?.message
      );

      res
        .status(502)
        .json({
          error:
            "Proxy request failed",

          detail:
            err?.message ||
            String(err)
        });
    }
  }
);

// ===== Ledger info =====

app.get(
  "/api/xrpl/ledger",
  async (_req, res) => {
    try {
      const data =
        await xrplRpc({
          method:
            "ledger",

          params: [
            {
              ledger_index:
                "validated"
            }
          ]
        });

      res.json(data);
    } catch (err) {
      console.error(
        "ledger error",
        err?.message ||
          err
      );

      res
        .status(502)
        .json({
          error:
            "Ledger fetch failed",

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

      const data =
        await xrplRpc({
          method:
            "account_info",

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
        err?.message ||
          err
      );

      res
        .status(502)
        .json({
          error:
            "Account fetch failed",

          detail:
            err?.message ||
            String(err)
        });
    }
  }
);

// ===== XRBitcoinCash support email through Resend HTTPS =====

app.post(
  "/api/support/email",
  supportRateLimit,
  async (req, res) => {
    res.set({
      "Cache-Control":
        "no-store",

      "X-Content-Type-Options":
        "nosniff"
    });

    if (
      !supportOriginAllowed(
        req
      )
    ) {
      return res
        .status(403)
        .json({
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
       * Bots filling this field
       * receive a neutral success
       * response, but no email is sent.
       */
      if (data.website) {
        return res
          .status(202)
          .json({
            ok: true,
            requestId
          });
      }

      if (
        !supportEmailConfigured()
      ) {
        return res
          .status(503)
          .json({
            ok: false,

            message:
              "The support email service is not configured yet."
          });
      }

      const userAgent =
        cleanText(
          req.get(
            "user-agent"
          ),
          350
        ) ||
        "Not supplied";

      const {
        subject,
        text,
        html
      } =
        buildSupportEmail(
          data,
          requestId,
          userAgent
        );

      const resendEmailId =
        await sendSupportEmailWithResend({
          data,
          requestId,
          subject,
          text,
          html
        });

      console.log(
        "[support email sent]",
        {
          requestId,
          provider:
            "resend",
          resendEmailId
        }
      );

      return res
        .status(200)
        .json({
          ok: true,
          requestId,
          provider:
            "resend"
        });
    } catch (err) {
      const isValidationError =
        err instanceof
          SupportValidationError;

      const message =
        cleanText(
          err?.message ||
            "Unknown error",
          500
        );

      if (
        !isValidationError
      ) {
        console.error(
          "[support email error]",
          {
            requestId,

            provider:
              "resend",

            code:
              err?.code ||
              "",

            responseCode:
              err?.responseCode ||
              err?.response
                ?.status ||
              "",

            message
          }
        );
      }

      return res
        .status(
          isValidationError
            ? 400
            : 502
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
      const {
        messages
      } =
        req.body || {};

      if (
        !Array.isArray(
          messages
        ) ||
        messages.length ===
          0
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

      const trimmed =
        messages.slice(-10);

      const payload = {
        model:
          OPENAI_MODEL,

        messages:
          trimmed,

        temperature:
          0.6,

        max_tokens:
          600
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

            timeout:
              30000,

            validateStatus:
              () => true
          }
        );

      if (
        response.status ===
        401
      ) {
        return res
          .status(502)
          .json({
            error:
              "OpenAI auth failed (401)",

            detail:
              response.data
          });
      }

      if (
        response.status ===
        429
      ) {
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
        response.status <
          200 ||
        response.status >=
          300
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

      res.json(
        response.data
      );
    } catch (err) {
      console.error(
        "[chat proxy error]",
        err?.message ||
          err
      );

      res
        .status(502)
        .json({
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
// This route never returns passwords or API-key values.

app.get(
  "/env-check",
  (_req, res) => {
    res.json({
      hasOpenAIKey:
        Boolean(
          OPENAI_KEY
        ),

      model:
        OPENAI_MODEL,

      supportEmailProvider:
        "resend",

      hasResendApiKey:
        Boolean(
          RESEND_API_KEY
        ),

      hasSupportEmailDestination:
        Boolean(
          SUPPORT_EMAIL_TO
        ),

      hasSupportEmailSender:
        Boolean(
          SUPPORT_EMAIL_FROM
        ),

      supportEmailConfigured:
        supportEmailConfigured(),

      supportEmailFrom:
        SUPPORT_EMAIL_FROM,

      supportAllowedOrigins:
        Array.from(
          SUPPORT_ALLOWED_ORIGINS
        )
    });
  }
);

// ===== BEGIN XRBC OPTIONAL LP RECEIPTS 0.1.11 =====
// Self-contained, read-only metadata service. No additional deployment files.
// The source modules below are kept readable for audit and bundled without eval.
// Existing XRPL, chat, support, middleware and environment settings are untouched.
(() => {
  const modules = Object.create(null);
  const cache = Object.create(null);
  const privateGlobals = Object.create(null);
  modules["./liquidity-core.cjs"] = function (module, exports, require, globalThis) {

/* XRBC Liquidity Workspace 0.1.0 — pure transaction and decimal helpers.
 * Native AMM modes verified against XRPLF/rippled release/3.3.x on 2026-09-05.
 * This is application code, not a protocol implementation or security certification.
 */
(function (root) {
  'use strict';
  const SCALE = 10n ** 96n;
  const DROP = SCALE / 1000000n;
  const XRBC = Object.freeze({symbol:'XRBC', label:'XRBitcoinCash', currency:'5852626974636F696E6361736800000000000000', issuer:'rEjwniYhYR5QDZzK1a1x2359j8j8N43Ypw'});
  // Exact identities copied from the supplied index.html, not ticker-based discovery.
  const QUOTES = Object.freeze({
    XRP:Object.freeze({symbol:'XRP',label:'Native XRP',currency:'XRP'}),
    RLUSD:Object.freeze({symbol:'RLUSD',label:'Ripple USD',currency:'524C555344000000000000000000000000000000',issuer:'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'}),
    BTC:Object.freeze({symbol:'BTC',label:'GateHub Crypto BTC',currency:'BTC',issuer:'rchGBxcD1A1C2tdxF6papQYZ8kjRKMYcL'}),
    ETH:Object.freeze({symbol:'ETH',label:'GateHub Crypto ETH',currency:'ETH',issuer:'rcA8X3TVMST1n3CJeAdGk1RdRCHii7N2h'}),
    USDT:Object.freeze({symbol:'USDT',label:'GateHub Crypto USDT',currency:'5553445400000000000000000000000000000000',issuer:'rcvxE9PS9YBwxtGg1qNeewV6ZB3wGubZq'}),
    USDC:Object.freeze({symbol:'USDC',label:'Circle USDC on XRPL',currency:'5553444300000000000000000000000000000000',issuer:'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'}),
    BCH:Object.freeze({symbol:'BCH',label:'GateHub Crypto BCH',currency:'BCH',issuer:'rcyS4CeCZVYvTiKcxj6Sx32ibKwcDHLds'})
  });
  const FLAGS=Object.freeze({deposit:1048576,withdraw:65536,noRipple:131072,canonical:2147483648});
  const fail = (message) => { throw new Error(message); };
  function dec(value) {
    if(typeof value === 'bigint') return value;
    const s=String(value).trim();
    if(s.length>220) return fail('Decimal is too long.');
    const m=/^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d{1,3}))?$/.exec(s);
    if(!m) return fail('Invalid decimal amount: '+s.slice(0,35));
    const exponent=Number(m[4]||0), fraction=m[3]||'';
    const places=96+exponent-fraction.length;
    if(places<0||places>192) return fail('Amount is outside supported precision.');
    const n=BigInt(m[2]+fraction)*(10n**BigInt(places))*(m[1]?-1n:1n);
    if(n!==0n && (n<0n?-n:n)>=10n**192n) return fail('Amount exceeds XRPL issued-currency range.');
    return n;
  }
  function text(n) {
    n=dec(n); const neg=n<0n; if(neg)n=-n;
    const all=n.toString().padStart(97,'0');
    const fraction=all.slice(-96).replace(/0+$/,'');
    return (neg?'-':'')+all.slice(0,-96)+(fraction?'.'+fraction:'');
  }
  const mul=(a,b)=>dec(a)*dec(b)/SCALE;
  const div=(a,b)=>{a=dec(a);b=dec(b);return b===0n?fail('Division by zero.'):a*SCALE/b;};
  const min=(a,b)=>a<b?a:b;
  const abs=n=>n<0n?-n:n;
  function significant(n,digits=16) {
    n=dec(n); if(n<=0n)return n;
    const discard=n.toString().length-digits;
    if(discard<=0)return n;
    const step=10n**BigInt(discard); return n/step*step;
  }
  function iouValue(n) {
    n=significant(n,16);
    if(n<=0n || n<dec('1e-81')) return fail('Issued amount rounds below the XRPL minimum.');
    return text(n);
  }
  function currency(c) {
    const s=String(c||'');
    if(/^[a-fA-F0-9]{40}$/.test(s))return s.toUpperCase();
    // Three-character codes are case sensitive. Never trim trailing hex zeroes.
    if(/^[\x21-\x7E]{3}$/.test(s))return s;
    return fail('Invalid currency identifier.');
  }
  const native=a=>a?.currency==='XRP'&&!a?.issuer;
  const issue=a=>native(a)?{currency:'XRP'}:{currency:currency(a.currency),issuer:a.issuer};
  const same=(a,b)=>!!a&&!!b&&currency(a.currency)===currency(b.currency)&&(a.issuer||'')===(b.issuer||'');
  function amount(asset,n) {
    n=dec(n);
    if(n<=0n)return fail('Amount must be positive.');
    if(native(asset)){
      const drops=n/DROP;
      if(drops<=0n || drops>100000000000000000n) return fail('XRP amount is outside range.');
      return drops.toString();
    }
    return {...issue(asset),value:iouValue(n)};
  }
  function amountValue(a,asset) {
    if(native(asset)) {
      if(typeof a!=='string'||!/^\d+$/.test(a))return fail('Expected native XRP drops.');
      return BigInt(a)*DROP;
    }
    if(typeof a!=='object'||!same(a,asset))return fail('Issued amount identity mismatch.');
    return dec(a.value);
  }
  function userAmount(input,asset) {
    const s=String(input||'').trim();
    if(!/^(?:\d+\.?\d*|\.\d+)$/.test(s)||s.length>110)return fail('Enter a positive decimal, without commas or exponents.');
    const n=dec(s.startsWith('.')?'0'+s:s);
    if(n<=0n)return fail('Enter an amount greater than zero.');
    const a=amount(asset,n);
    if(amountValue(a,asset)!==n)return fail(native(asset)?'XRP supports at most six decimal places.':'Use at most 16 significant digits for issued assets.');
    return n;
  }
  const classic=a=>/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(String(a||''));
  function normalizePool(result,quote,ledger) {
    if(result.validated!==true)return fail('Pool response is not explicitly validated.');
    if(result.ledger_hash && String(result.ledger_hash).toUpperCase()!==ledger.hash)return fail('Pool ledger hash does not match the snapshot.');
    if(result.ledger_index && Number(result.ledger_index)!==ledger.index)return fail('Pool ledger index does not match the snapshot.');
    const a=result.amm;
    if(!a||!classic(a.account))return fail('AMM account is missing or invalid.');
    const inputs=[a.amount,a.amount2];
    const find=asset=>inputs.find(x=>native(asset)?typeof x==='string':typeof x==='object'&&same(x,asset));
    const reserveA=amountValue(find(XRBC),XRBC),reserveB=amountValue(find(quote),quote);
    const lp=a.lp_token;
    if(!lp||lp.issuer!==a.account||!/^03[A-Fa-f0-9]{38}$/.test(lp.currency||''))return fail('LP token identity does not match the AMM.');
    const supply=dec(lp.value);
    if(supply<=0n||reserveA<=0n||reserveB<=0n)return fail('Pool is empty. This build does not create or refill empty AMMs.');
    const fee=Number(a.trading_fee);
    if(!Number.isInteger(fee)||fee<0||fee>1000)return fail('Invalid AMM trading fee.');
    return {account:a.account,lp:issue(lp),supply,reserveA,reserveB,fee,quote,
      frozen:a.asset_frozen===true||a.asset2_frozen===true,ledger};
  }
  function depositQuote(pool,capA,capB,bps) {
    if(![10,50,100,200].includes(bps))return fail('Unsupported tolerance.');
    const ratio=min(div(capA,pool.reserveA),div(capB,pool.reserveB));
    const estimate=significant(mul(pool.supply,ratio),16);
    const minimum=significant(estimate*BigInt(10000-bps)/10000n,16);
    if(minimum<=0n)return fail('Deposit is too small for a meaningful LP output.');
    return {capA,capB,estimate,minimum,usedA:mul(pool.reserveA,ratio),usedB:mul(pool.reserveB,ratio),bps};
  }
  function withdrawalQuote(pool,lpIn,balance) {
    if(lpIn<=0n||lpIn>balance||lpIn>pool.supply)return fail('LP amount exceeds the available position.');
    const ratio=div(lpIn,pool.supply);
    return {lpIn,outA:mul(pool.reserveA,ratio),outB:mul(pool.reserveB,ratio)};
  }
  function buildTx({kind,account,pool,quote,fee,sequence,lastLedger,memos}) {
    if(!classic(account))return fail('Connect a valid wallet first.');
    if(!/^\d+$/.test(String(fee))||BigInt(fee)<=0n||BigInt(fee)>10000n)return fail('Network fee exceeds the 0.01 XRP interface ceiling.');
    if(!Number.isSafeInteger(sequence)||sequence<1||!Number.isSafeInteger(lastLedger)||lastLedger<1)return fail('Sequence or ledger bound is unavailable.');
    const tx={TransactionType:kind==='deposit'?'AMMDeposit':'AMMWithdraw',Account:account,
      Asset:issue(XRBC),Asset2:issue(pool.quote),Flags:FLAGS[kind],Fee:String(fee),Sequence:sequence,LastLedgerSequence:lastLedger,Memos:memos};
    if(kind==='deposit'){
      tx.Amount=amount(XRBC,quote.capA);tx.Amount2=amount(pool.quote,quote.capB);
      tx.LPTokenOut=amount(pool.lp,quote.minimum);
    }else if(kind==='withdraw')tx.LPTokenIn=amount(pool.lp,quote.lpIn);
    else return fail('Unsupported AMM operation.');
    assertTx(tx,pool); return tx;
  }
  function assertTx(tx,pool) {
    const shared=['TransactionType','Account','Fee','Sequence','LastLedgerSequence','Memos'];
    const type=tx.TransactionType;
    const allowed=shared.concat(type==='TrustSet'?['LimitAmount','Flags']:['Asset','Asset2','Flags',...(type==='AMMDeposit'?['Amount','Amount2','LPTokenOut']:['LPTokenIn'])]);
    if(!['AMMDeposit','AMMWithdraw','TrustSet'].includes(type))return fail('Transaction type is not allowed.');
    for(const key of Object.keys(tx))if(!allowed.includes(key))return fail('Unexpected transaction field: '+key);
    if(!classic(tx.Account))return fail('Invalid signing account.');
    if(!/^\d+$/.test(tx.Fee)||BigInt(tx.Fee)>10000n||BigInt(tx.Fee)<=0n)return fail('Invalid or excessive network fee.');
    if(!Number.isSafeInteger(tx.Sequence)||tx.Sequence<1||!Number.isSafeInteger(tx.LastLedgerSequence)||tx.LastLedgerSequence<1)return fail('Missing replay or expiry bound.');
    if(!Array.isArray(tx.Memos)||tx.Memos.length!==1||!tx.Memos[0]?.Memo?.MemoData)return fail('Verification memo is missing.');
    if(type==='TrustSet'){
      if(tx.Flags!==FLAGS.noRipple)return fail('Trustline must enable NoRipple without changing other flags.');
      if(!same(tx.LimitAmount,XRBC)&&!Object.values(QUOTES).filter(x=>!native(x)).some(x=>same(x,tx.LimitAmount)))return fail('Trustline asset is not pinned.');
      if(dec(tx.LimitAmount.value)<=0n)return fail('Trustline limit must be positive.');
    }else{
      if(!pool||!same(tx.Asset,XRBC)||!same(tx.Asset2,pool.quote))return fail('Pool pair changed.');
      if(type==='AMMDeposit'){
        if(tx.Flags!==FLAGS.deposit)return fail('Only capped two-asset deposits are supported.');
        if(amountValue(tx.Amount,XRBC)<=0n||amountValue(tx.Amount2,pool.quote)<=0n||amountValue(tx.LPTokenOut,pool.lp)<=0n)return fail('Deposit bounds are missing.');
      }else{
        if(tx.Flags!==FLAGS.withdraw)return fail('Only exact-LP proportional withdrawals are supported.');
        if(amountValue(tx.LPTokenIn,pool.lp)<=0n)return fail('LP debit cap is missing.');
      }
    }
    return true;
  }
  function stable(value) {
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  function equalField(a,b) {
    if(a&&b&&typeof a==='object'&&'value'in a&&'currency'in a&&'value'in b&&'currency'in b){
      return same(a,b)&&dec(a.value)===dec(b.value)&&Object.keys(b).every(k=>['currency','issuer','value'].includes(k));
    }
    return stable(a)===stable(b);
  }
  function compareTx(expected,actual) {
    if(!actual||typeof actual!=='object')return fail('Returned transaction is missing.');
    // Signing fields and known response metadata are the only additions allowed.
    const additions=['SigningPubKey','TxnSignature','Signers','hash','ctid','date','ledger_index','inLedger'];
    for(const k of Object.keys(actual)){
      if(k in expected||additions.includes(k))continue;
      if(k==='NetworkID'&&actual[k]===0)continue;
      return fail('Returned transaction added an unexpected field: '+k);
    }
    for(const k of Object.keys(expected)){
      if(k==='Flags'){
        if(((Number(actual[k])>>>0)&~FLAGS.canonical)!==expected[k])return fail('Transaction flags changed.');
      }else if(!equalField(expected[k],actual[k]))return fail('Transaction changed: '+k);
    }
    return true;
  }
  function effects(meta,account,assets) {
    if(!Array.isArray(meta?.AffectedNodes))return fail('Transaction metadata is unavailable.');
    const result={xrp:0n}; for(const a of assets)result[a.key]=0n;
    for(const wrapper of meta.AffectedNodes){
      const n=wrapper.ModifiedNode||wrapper.CreatedNode||wrapper.DeletedNode;if(!n)continue;
      const created=!!wrapper.CreatedNode,deleted=!!wrapper.DeletedNode;
      const fields=n.FinalFields||n.NewFields||{},before=n.PreviousFields||{};
      if(n.LedgerEntryType==='AccountRoot'&&fields.Account===account){
        const old=created?0n:BigInt(before.Balance??fields.Balance??'0');
        const now=deleted?0n:BigInt(fields.Balance??'0');result.xrp+=(now-old)*DROP;
      }
      if(n.LedgerEntryType!=='RippleState')continue;
      const low=fields.LowLimit?.issuer,high=fields.HighLimit?.issuer;
      if(low!==account&&high!==account)continue;
      const peer=low===account?high:low,sign=low===account?1n:-1n;
      const c=fields.Balance?.currency||fields.LowLimit?.currency;
      const old=created?0n:dec(before.Balance?.value??fields.Balance?.value??'0');
      const now=deleted?0n:dec(fields.Balance?.value??'0');
      for(const a of assets)if(same({currency:c,issuer:peer},a))result[a.key]+=(now-old)*sign;
    }
    return result;
  }
  function checkEffects(tx,meta,pool) {
    const assets=pool?[{...XRBC,key:'a'},...(!native(pool.quote)?[{...pool.quote,key:'b'}]:[]),{...pool.lp,key:'lp'}]:[];
    const e=effects(meta,tx.Account,assets),fee=BigInt(tx.Fee)*DROP;
    if(tx.TransactionType==='TrustSet'){
      if(e.xrp!==-fee)return fail('Trustline simulation has an unexpected XRP movement.');return e;
    }
    if(native(pool.quote))e.b=e.xrp+fee;
    else if(e.xrp!==-fee)return fail('Unexpected XRP movement outside the network fee.');
    if(tx.TransactionType==='AMMDeposit'){
      if(e.a>=0n||e.b>=0n||-e.a>amountValue(tx.Amount,XRBC)||-e.b>amountValue(tx.Amount2,pool.quote))return fail('Simulation debit exceeds the reviewed deposit caps or is invalid.');
      if(e.lp<amountValue(tx.LPTokenOut,pool.lp))return fail('Simulation does not meet the minimum LP output.');
    }else{
      if(e.lp>=0n||-e.lp>amountValue(tx.LPTokenIn,pool.lp)||e.a<=0n||e.b<=0n)return fail('Withdrawal simulation has unexpected LP or asset movements.');
    }
    return e;
  }
  root.XRBC_AMM_CORE=Object.freeze({SCALE,DROP,XRBC,QUOTES,FLAGS,dec,text,mul,div,min,abs,significant,iouValue,native,issue,same,amount,amountValue,userAmount,classic,normalizePool,depositQuote,withdrawalQuote,buildTx,assertTx,stable,compareTx,effects,checkEffects});
})(globalThis);


module.exports=globalThis.XRBC_AMM_CORE;

  };
  modules["./liquidity-receipt-core.cjs"] = function (module, exports, require, globalThis) {
/* XRBC LP receipts v1: shared, wallet-independent ledger/metadata helpers. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./liquidity-core.cjs'));
  else root.XRBC_LP_RECEIPTS=factory(root.XRBC_AMM_CORE);
})(globalThis,function(C){
  'use strict';
  const HASH=/^[A-Fa-f0-9]{64}$/, TAXON=1481785923, SCHEMA='xrbc-lp-receipt-v1';
  const fail=m=>{throw new Error(m);};
  const hex=s=>Array.from(new TextEncoder().encode(s),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  function unhex(s){if(typeof s!=='string'||s.length%2||!/^[A-Fa-f0-9]*$/.test(s))fail('Invalid hexadecimal data.');return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(s.match(/../g)||[],b=>parseInt(b,16)));}
  function cleanLedgerTx(result){
    const tx={...(result.tx_json||result)};
    for(const key of ['SigningPubKey','TxnSignature','Signers','hash','ctid','date','ledger_index','inLedger','validated','meta','meta_blob','status','warnings','close_time_iso'])delete tx[key];
    if(tx.NetworkID===0)delete tx.NetworkID;
    if(Number.isInteger(tx.Flags))tx.Flags=(tx.Flags>>>0)&~C.FLAGS.canonical;
    return tx;
  }
  function fromLedger(result,expectedHash){
    if(!HASH.test(expectedHash||'')||String(result.hash||result.tx_json?.hash||'').toUpperCase()!==expectedHash.toUpperCase())fail('Receipt transaction hash mismatch.');
    if(result.validated!==true||result.meta?.TransactionResult!=='tesSUCCESS')fail('A receipt requires a successful validated transaction.');
    const ledger=result.ledger_index||result.tx_json?.ledger_index;
    if(!Number.isInteger(ledger)||ledger<1||ledger>4294967295)fail('Receipt ledger is invalid.');
    const tx=cleanLedgerTx(result);
    if(!['AMMDeposit','AMMWithdraw'].includes(tx.TransactionType))fail('Only a liquidity deposit or withdrawal can create this receipt.');
    const pair=Object.keys(C.QUOTES).find(k=>C.same(C.QUOTES[k],tx.Asset2));
    if(!pair||!C.same(C.XRBC,tx.Asset))fail('Receipt pair is not supported.');
    const lp=tx.TransactionType==='AMMDeposit'?tx.LPTokenOut:tx.LPTokenIn;
    if(!C.classic(lp?.issuer)||!/^03[A-Fa-f0-9]{38}$/.test(lp?.currency||''))fail('Receipt LP identity is invalid.');
    C.assertTx(tx,{quote:C.QUOTES[pair],lp});
    if(!Number.isInteger(tx.LastLedgerSequence)||tx.LastLedgerSequence<ledger)fail('Receipt validated after its signed deadline.');
    const e=C.checkEffects(tx,result.meta,{quote:C.QUOTES[pair],lp});
    const asset=(a,value)=>({...C.issue(a),symbol:a.symbol,value:C.text(C.abs(value))});
    return {schema:SCHEMA,network:'XRPL Mainnet',transactionHash:expectedHash.toUpperCase(),ledger,
      account:tx.Account,kind:tx.TransactionType==='AMMDeposit'?'deposit':'withdraw',pair,
      assetA:asset(C.XRBC,e.a),assetB:asset(C.QUOTES[pair],e.b),
      lp:{currency:lp.currency.toUpperCase(),issuer:lp.issuer,value:C.text(C.abs(e.lp))},
      feeXrp:C.text(BigInt(tx.Fee)*C.DROP),amountBasis:'wallet movements excluding XRP network fee'};
  }
  function assertRecord(r){
    if(r?.schema!==SCHEMA||r.network!=='XRPL Mainnet'||!HASH.test(r.transactionHash||'')||!C.classic(r.account)||!['deposit','withdraw'].includes(r.kind)||!C.QUOTES[r.pair])fail('Invalid LP receipt.');
    if(!Number.isInteger(r.ledger)||r.ledger<1||r.ledger>4294967295)fail('Invalid receipt ledger.');
    if(!C.same(r.assetA,C.XRBC)||r.assetA.symbol!=='XRBC'||!C.same(r.assetB,C.QUOTES[r.pair])||r.assetB.symbol!==r.pair)fail('Receipt asset identity changed.');
    if(!C.classic(r.lp?.issuer)||!/^03[A-Fa-f0-9]{38}$/.test(r.lp?.currency||''))fail('Invalid receipt LP token.');
    for(const a of [r.assetA,r.assetB,r.lp])if(C.dec(a.value)<=0n||C.text(C.dec(a.value))!==a.value)fail('Receipt amount must be a positive canonical decimal.');
    if(C.dec(r.feeXrp)<=0n||C.dec(r.feeXrp)>C.dec('0.01'))fail('Invalid receipt fee.');
    return r;
  }
  function urls(base,r,digest){
    assertRecord(r);if(!/^[a-f0-9]{64}$/.test(digest||''))fail('Receipt digest is invalid.');
    const b=new URL(base);if(b.protocol!=='https:'||b.username||b.password||b.search||b.hash)fail('Receipt metadata requires a public HTTPS base URL.');
    const path=b.href.replace(/\/$/,'')+'/api/lp-receipts/'+r.transactionHash;
    const metadata=path+'.json?d='+digest,image=path+'.png?d='+digest;
    if(new TextEncoder().encode(metadata).length>256)fail('Receipt URI exceeds the current XRPL 256-byte limit.');
    return {metadata,image};
  }
  function metadata(base,r,digest){
    const u=urls(base,r,digest),deposit=r.kind==='deposit',verb=deposit?'Wallet spent':'Wallet received';
    return {name:'XRBC / '+r.pair+' '+(deposit?'deposit':'withdrawal')+' receipt',
      description:verb+' '+r.assetA.value+' XRBC and '+r.assetB.value+' '+r.pair+'. '+r.lp.value+' LP tokens '+(deposit?'received':'redeemed')+'. Historical transaction receipt; it does not represent current LP ownership or redemption rights.',
      image:u.image,external_url:'https://livenet.xrpl.org/transactions/'+r.transactionHash,
      attributes:[{trait_type:'Action',value:deposit?'Deposit':'Withdrawal'},
        {trait_type:'XRBC amount',value:r.assetA.value},{trait_type:r.pair+' amount',value:r.assetB.value},
        {trait_type:'LP tokens '+(deposit?'received':'redeemed'),value:r.lp.value},
        {trait_type:'Ledger',value:r.ledger},{trait_type:'Transaction',value:r.transactionHash}],
      xrbc:{receipt:r,sha256:digest}};
  }
  function mintMemo(memos,r,digest,includeGuide=true){
    assertRecord(r);const m=JSON.parse(JSON.stringify(memos)),data=unhex(m[0]?.Memo?.MemoData||'');
    const added='|SOURCE='+r.transactionHash+'|A='+r.assetA.value+' XRBC|B='+r.assetB.value+' '+r.pair+'|LP='+r.lp.value+'|SHA256='+digest;
    const guide=includeGuide?'|MANAGE=https://xrbitcoincash.com/xrbc-liquidity-pool.html?pair='+r.pair+'#withdrawForm':'';
    m[0].Memo.MemoData=hex(data+added+guide);
    if(Object.values(m[0].Memo).reduce((n,v)=>n+v.length/2,0)>800)fail('Receipt memo exceeds the compact interface limit.');
    return m;
  }
  function assertMint(tx,source,digest,base){
    assertRecord(source);
    const expected=['TransactionType','Account','Fee','Sequence','LastLedgerSequence','Memos','Flags','URI','NFTokenTaxon'];
    if(Object.keys(tx).some(k=>!expected.includes(k))||expected.some(k=>!(k in tx)))fail('Unexpected NFT receipt transaction fields.');
    if(tx.TransactionType!=='NFTokenMint'||tx.Account!==source.account||tx.Flags!==0||tx.NFTokenTaxon!==TAXON)fail('NFT receipt mint controls changed.');
    if(tx.URI!==hex(urls(base,source,digest).metadata))fail('NFT receipt URI changed.');
    if(!/^\d+$/.test(tx.Fee)||BigInt(tx.Fee)<1n||BigInt(tx.Fee)>10000n)fail('Invalid NFT mint fee.');
    if(!Number.isInteger(tx.Sequence)||tx.Sequence<1||!Number.isInteger(tx.LastLedgerSequence)||tx.LastLedgerSequence<1||tx.Sequence>4294967295||tx.LastLedgerSequence>4294967295)fail('NFT mint requires an account sequence and ledger deadline.');
    if(!Array.isArray(tx.Memos)||tx.Memos.length!==1||Object.keys(tx.Memos[0]).join()!=='Memo')fail('NFT receipt memo is invalid.');
    const memo=tx.Memos[0].Memo;
    if(Object.keys(memo).some(k=>!['MemoType','MemoFormat','MemoData'].includes(k))||unhex(memo.MemoType)!=='XRBC_LIQUIDITY'||unhex(memo.MemoFormat)!=='text/plain')fail('NFT receipt memo format changed.');
    const text=unhex(memo.MemoData),i=text.indexOf('|SOURCE=');
    const prefix=text.slice(0,i);
    if(i<0||!/^APP=XRBC_LIQUIDITY\|DOMAIN=[a-z0-9.-]+\|CHALLENGE=\d{6}\|INTENT=[a-f0-9-]{36}$/i.test(prefix))fail('NFT receipt challenge is missing.');
    const rebuilt=mintMemo([{Memo:{MemoType:memo.MemoType,MemoFormat:memo.MemoFormat,MemoData:hex(prefix)}}],source,digest);
    if(C.stable(tx.Memos)!==C.stable(rebuilt)&&C.stable(tx.Memos)!==C.stable(mintMemo([{Memo:{MemoType:memo.MemoType,MemoFormat:memo.MemoFormat,MemoData:hex(prefix)}}],source,digest,false)))fail('NFT receipt amounts or source binding changed.');
    return true;
  }
  function mintEffects(tx,meta){
    const e=C.effects(meta,tx.Account,[]);
    if(e.xrp!==-BigInt(tx.Fee)*C.DROP)fail('NFT mint has unexpected XRP movements.');
    const before=new Set(),after=new Map();
    for(const wrapper of meta.AffectedNodes){
      const n=wrapper.ModifiedNode||wrapper.CreatedNode||wrapper.DeletedNode;
      if(n?.LedgerEntryType!=='NFTokenPage')continue;
      const f=n.FinalFields||n.NewFields||{};
      if(!wrapper.CreatedNode)for(const v of n.PreviousFields?.NFTokens||f.NFTokens||[])before.add(v.NFToken?.NFTokenID);
      if(!wrapper.DeletedNode)for(const v of f.NFTokens||[])after.set(v.NFToken?.NFTokenID,v.NFToken);
    }
    const added=[...after.values()].filter(n=>n&&!before.has(n.NFTokenID));
    if(added.length!==1||!HASH.test(added[0].NFTokenID||'')||added[0].URI!==tx.URI)fail('The exact newly minted NFT was not found in ledger metadata.');
    const id=meta.nftoken_id||meta.NFTokenID;
    if(id&&id!==added[0].NFTokenID)fail('Minted NFT identifiers disagree.');
    return {...e,nftokenId:added[0].NFTokenID};
  }
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function scene(r){
    assertRecord(r);const nodes=[],rect=(x,y,w,h,color)=>nodes.push({type:'rect',x,y,w,h,color});
    const text=(value,x,y,scale,color='#e9f0fa')=>nodes.push({type:'text',value:String(value).toUpperCase(),x,y,scale,color});
    const lines=(value,x,y,max=29,scale=3)=>{for(let i=0;i<value.length;i+=max)text(value.slice(i,i+max),x,y+(i/max)*(scale*9),scale);};
    rect(0,0,1200,720,'#08111e');rect(24,24,1152,5,'#f0c667');
    text('XRBITCOINCASH',50,52,3,'#f0c667');text(r.kind==='deposit'?'LIQUIDITY DEPOSIT':'LIQUIDITY WITHDRAWAL',50,98,5);
    const caption=r.kind==='deposit'?'SPENT':'RECEIVED';
    for(const [a,x] of [[r.assetA,50],[r.assetB,620]]){rect(x,162,530,265,'#112237');text(a.symbol,x+22,183,4,'#87baff');text(caption,x+22,227,2,'#a8b7ca');lines(a.value,x+22,263,a.value.length>24?39:a.value.length>12?24:12,a.value.length>24?2:a.value.length>12?3:6);}
    text('LP TOKENS '+(r.kind==='deposit'?'RECEIVED':'REDEEMED'),50,457,2,'#a8b7ca');lines(r.lp.value,50,484,r.lp.value.length>60?90:60,r.lp.value.length>60?2:3);
    text('LEDGER '+r.ledger+'  /  NETWORK FEE '+r.feeXrp+' XRP',50,548,2,'#a8b7ca');
    text('TRANSACTION',50,585,2,'#f0c667');text(r.transactionHash,50,610,2);
    text('HISTORICAL RECEIPT / LP TOKENS CONTROL REDEMPTION',50,650,2,'#a8b7ca');
    nodes.push({type:'text',value:'WITHDRAW: XRBITCOINCASH.COM',x:50,y:685,scale:2,color:'#87baff'});return nodes;
  }
  function svg(r){return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">'+scene(r).map(n=>n.type==='rect'?'<rect x="'+n.x+'" y="'+n.y+'" width="'+n.w+'" height="'+n.h+'" fill="'+n.color+'"/>':'<text x="'+n.x+'" y="'+(n.y+n.scale*7)+'" fill="'+n.color+'" font-family="monospace" font-size="'+n.scale*8+'" font-weight="700">'+escape(n.value)+'</text>').join('')+'</svg>';}
  return Object.freeze({SCHEMA,TAXON,hex,unhex,fromLedger,assertRecord,urls,metadata,mintMemo,assertMint,mintEffects,scene,svg});
});

  };
  modules["./receipt-png.cjs"] = function (module, exports, require, globalThis) {
'use strict';
/* XRBC receipt image v0.1.11. Deterministic PNG, Node built-ins only.
 * Font mask data is embedded at build time; no system fonts, remote image
 * services, native extensions, or extra production packages are required.
 *
 * Embedded DejaVu font masks: Copyright (c) 2003 by Bitstream, Inc.
 * All Rights Reserved. Bitstream Vera is a trademark of Bitstream, Inc.
 * DejaVu changes are in public domain.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of the fonts accompanying this license ("Fonts") and associated
 * documentation files (the "Font Software"), to reproduce and distribute the
 * Font Software, including without limitation the rights to use, copy, merge,
 * publish, distribute, and/or sell copies of the Font Software, and to permit
 * persons to whom the Font Software is furnished to do so, subject to the
 * following conditions:
 * The above copyright and trademark notices and this permission notice shall
 * be included in all copies of one or more of the Font Software typefaces.
 * The Font Software may be modified, altered, or added to, and in particular
 * the designs of glyphs or characters in the Fonts may be modified and
 * additional glyphs or characters may be added to the Fonts, only if the fonts
 * are renamed to names not containing either the words "Bitstream" or the word
 * "Vera". This License becomes null and void to the extent applicable to Fonts
 * or Font Software that has been modified and is distributed under the
 * "Bitstream Vera" names. The Font Software may be sold as part of a larger
 * software package but no copy of one or more of the Font Software typefaces
 * may be sold by itself.
 * THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
 * TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME
 * FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING
 * ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
 * THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE
 * FONT SOFTWARE. Except as contained in this notice, the names of Gnome, the
 * Gnome Foundation, and Bitstream Inc., shall not be used in advertising or
 * otherwise to promote the sale, use or other dealings in this Font Software
 * without prior written authorization from the Gnome Foundation or Bitstream
 * Inc., respectively. For further information, contact: fonts at gnome dot org.
 */
const zlib = require('node:zlib');
const R = require('./liquidity-receipt-core.cjs');
const FONT_MASKS = {"label":{"size":22,"glyphs":{" ":[0,7,1,0,21,7.0],"!":[7,9,16,0,5,8.8125],"\"":[151,10,16,0,5,10.125],"#":[311,18,15,0,6,18.4375],"$":[581,14,20,0,4,14.0],"%":[861,21,16,0,5,20.90625],"&":[1197,17,16,0,5,17.15625],"'":[1469,6,16,0,5,6.046875],"(":[1565,9,20,0,4,8.578125],")":[1745,9,20,0,4,8.578125],"*":[1925,11,16,0,5,11.0],"+":[2101,18,14,0,7,18.4375],",":[2353,7,5,0,18,7.0],"-":[2388,8,7,0,14,7.9375],".":[2444,7,3,0,18,7.0],"/":[2465,8,18,0,5,7.40625],"0":[2609,14,16,0,5,14.0],"1":[2833,14,16,0,5,14.0],"2":[3057,14,16,0,5,14.0],"3":[3281,14,16,0,5,14.0],"4":[3505,14,16,0,5,14.0],"5":[3729,14,16,0,5,14.0],"6":[3953,14,16,0,5,14.0],"7":[4177,14,16,0,5,14.0],"8":[4401,14,16,0,5,14.0],"9":[4625,14,16,0,5,14.0],":":[4849,7,11,0,10,7.40625],";":[4926,7,13,0,10,7.40625],"<":[5017,18,13,0,8,18.4375],"=":[5251,18,11,0,10,18.4375],">":[5449,18,13,0,8,18.4375],"?":[5683,12,16,0,5,11.671875],"@":[5875,22,19,0,6,22.0],"A":[6293,15,16,0,5,15.046875],"B":[6533,15,16,0,5,15.09375],"C":[6773,15,16,0,5,15.359375],"D":[7013,17,16,0,5,16.9375],"E":[7285,14,16,0,5,13.90625],"F":[7509,13,16,0,5,12.65625],"G":[7717,17,16,0,5,17.046875],"H":[7989,17,16,0,5,16.546875],"I":[8261,6,16,0,5,6.484375],"J":[8357,8,20,-2,5,6.484375],"K":[8517,15,16,0,5,14.421875],"L":[8757,13,16,0,5,12.25],"M":[8965,19,16,0,5,18.984375],"N":[9269,16,16,0,5,16.453125],"O":[9525,17,16,0,5,17.3125],"P":[9797,13,16,0,5,13.265625],"Q":[10005,17,19,0,5,17.3125],"R":[10328,15,16,0,5,15.28125],"S":[10568,14,16,0,5,13.96875],"T":[10792,15,16,-1,5,13.4375],"U":[11032,16,16,0,5,16.109375],"V":[11288,15,16,0,5,15.046875],"W":[11528,22,16,0,5,21.75],"X":[11880,15,16,0,5,15.078125],"Y":[12120,15,16,-1,5,13.4375],"Z":[12360,15,16,0,5,15.078125],"[":[12600,9,20,0,4,8.578125],"\\":[12780,8,18,0,5,7.40625],"]":[12924,9,20,0,4,8.578125],"^":[13104,18,16,0,5,18.4375],"_":[13392,13,5,-1,21,11.0],"`":[13457,11,18,0,3,11.0],"a":[13655,13,12,0,9,13.484375],"b":[13811,14,17,0,4,13.96875],"c":[14049,12,12,0,9,12.09375],"d":[14193,14,17,0,4,13.96875],"e":[14431,14,12,0,9,13.53125],"f":[14599,9,17,0,4,7.75],"g":[14752,14,17,0,9,13.96875],"h":[14990,14,17,0,4,13.9375],"i":[15228,6,17,0,4,6.109375],"j":[15330,7,22,-1,4,6.109375],"k":[15484,13,17,0,4,12.734375],"l":[15705,6,17,0,4,6.109375],"m":[15807,21,12,0,9,21.4375],"n":[16059,14,12,0,9,13.9375],"o":[16227,13,12,0,9,13.453125],"p":[16383,14,17,0,9,13.96875],"q":[16621,14,17,0,9,13.96875],"r":[16859,10,12,0,9,9.046875],"s":[16979,11,12,0,9,11.46875],"t":[17111,9,15,0,6,8.625],"u":[17246,14,12,0,9,13.9375],"v":[17414,13,12,0,9,13.015625],"w":[17570,18,12,0,9,18.0],"x":[17786,13,12,0,9,13.015625],"y":[17942,13,17,0,9,13.015625],"z":[18163,12,12,0,9,11.546875],"{":[18307,14,20,0,4,14.0],"|":[18587,7,22,0,4,7.40625],"}":[18741,14,20,0,4,14.0],"~":[19021,18,10,0,11,18.4375]},"data":"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"},"body":{"size":26,"glyphs":{" ":[0,8,1,0,25,8.265625],"!":[8,10,19,0,6,10.421875],"\"":[198,12,19,0,6,11.953125],"#":[426,22,18,0,7,21.78125],"$":[822,17,24,0,5,16.546875],"%":[1230,25,19,0,6,24.703125],"&":[1705,20,19,0,6,20.28125],"'":[2085,7,19,0,6,7.140625],"(":[2218,10,23,0,5,10.140625],")":[2448,10,23,0,5,10.140625],"*":[2678,13,19,0,6,13.0],"+":[2925,22,16,0,9,21.78125],",":[3277,8,6,0,22,8.265625],"-":[3325,9,8,0,17,9.375],".":[3397,8,3,0,22,8.265625],"/":[3421,9,21,0,6,8.765625],"0":[3610,17,19,0,6,16.546875],"1":[3933,17,19,0,6,16.546875],"2":[4256,17,19,0,6,16.546875],"3":[4579,17,19,0,6,16.546875],"4":[4902,17,19,0,6,16.546875],"5":[5225,17,19,0,6,16.546875],"6":[5548,17,19,0,6,16.546875],"7":[5871,17,19,0,6,16.546875],"8":[6194,17,19,0,6,16.546875],"9":[6517,17,19,0,6,16.546875],":":[6840,9,13,0,12,8.765625],";":[6957,9,16,0,12,8.765625],"<":[7101,22,15,0,10,21.78125],"=":[7431,22,12,0,13,21.78125],">":[7695,22,15,0,10,21.78125],"?":[8025,14,19,0,6,13.796875],"@":[8291,26,23,0,7,26.0],"A":[8889,18,19,0,6,17.78125],"B":[9231,18,19,0,6,17.84375],"C":[9573,18,19,0,6,18.15625],"D":[9915,20,19,0,6,20.015625],"E":[10295,16,19,0,6,16.421875],"F":[10599,15,19,0,6,14.953125],"G":[10884,20,19,0,6,20.140625],"H":[11264,20,19,0,6,19.546875],"I":[11644,8,19,0,6,7.671875],"J":[11796,10,24,-2,6,7.671875],"K":[12036,18,19,0,6,17.046875],"L":[12378,15,19,0,6,14.484375],"M":[12663,22,19,0,6,22.4375],"N":[13081,19,19,0,6,19.453125],"O":[13442,20,19,0,6,20.46875],"P":[13822,16,19,0,6,15.671875],"Q":[14126,20,22,0,6,20.46875],"R":[14566,18,19,0,6,18.0625],"S":[14908,17,19,0,6,16.5],"T":[15231,17,19,-1,6,15.875],"U":[15554,19,19,0,6,19.03125],"V":[15915,18,19,0,6,17.78125],"W":[16257,26,19,0,6,25.703125],"X":[16751,18,19,0,6,17.8125],"Y":[17093,17,19,-1,6,15.875],"Z":[17416,18,19,0,6,17.8125],"[":[17758,10,23,0,5,10.140625],"\\":[17988,9,21,0,6,8.765625],"]":[18177,10,23,0,5,10.140625],"^":[18407,22,19,0,6,21.78125],"_":[18825,15,6,-1,25,13.0],"`":[18915,13,21,0,4,13.0],"a":[19188,16,14,0,11,15.9375],"b":[19412,17,20,0,5,16.5],"c":[19752,14,14,0,11,14.296875],"d":[19948,17,20,0,5,16.5],"e":[20288,16,14,0,11,16.0],"f":[20512,10,20,0,5,9.15625],"g":[20712,17,19,0,11,16.5],"h":[21035,16,20,0,5,16.484375],"i":[21355,7,20,0,5,7.21875],"j":[21495,8,25,-1,5,7.21875],"k":[21695,15,20,0,5,15.0625],"l":[21995,7,20,0,5,7.21875],"m":[22135,25,14,0,11,25.328125],"n":[22485,16,14,0,11,16.484375],"o":[22709,16,14,0,11,15.90625],"p":[22933,17,19,0,11,16.5],"q":[23256,17,19,0,11,16.5],"r":[23579,11,14,0,11,10.6875],"s":[23733,14,14,0,11,13.546875],"t":[23929,10,18,0,7,10.1875],"u":[24109,16,14,0,11,16.484375],"v":[24333,15,14,0,11,15.390625],"w":[24543,21,14,0,11,21.265625],"x":[24837,15,14,0,11,15.390625],"y":[25047,15,19,0,11,15.390625],"z":[25332,14,14,0,11,13.640625],"{":[25528,17,24,0,5,16.546875],"|":[25936,9,26,0,5,8.765625],"}":[26170,17,24,0,5,16.546875],"~":[26578,22,11,0,14,21.78125]},"data":"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"},"detail":{"size":22,"glyphs":{" ":[0,13,1,0,21,13.25],"!":[13,13,16,0,5,13.25],"\"":[221,13,16,0,5,13.25],"#":[429,14,15,0,6,13.25],"$":[639,13,20,0,4,13.25],"%":[899,13,16,0,5,13.25],"&":[1107,14,16,0,5,13.25],"'":[1331,13,16,0,5,13.25],"(":[1539,13,20,0,4,13.25],")":[1799,13,20,0,4,13.25],"*":[2059,13,16,0,5,13.25],"+":[2267,13,13,0,8,13.25],",":[2436,13,6,0,18,13.25],"-":[2514,13,7,0,14,13.25],".":[2605,13,3,0,18,13.25],"/":[2644,13,18,0,5,13.25],"0":[2878,13,16,0,5,13.25],"1":[3086,13,16,0,5,13.25],"2":[3294,13,16,0,5,13.25],"3":[3502,13,16,0,5,13.25],"4":[3710,13,16,0,5,13.25],"5":[3918,13,16,0,5,13.25],"6":[4126,13,16,0,5,13.25],"7":[4334,13,16,0,5,13.25],"8":[4542,13,16,0,5,13.25],"9":[4750,13,16,0,5,13.25],":":[4958,13,11,0,10,13.25],";":[5101,13,14,0,10,13.25],"<":[5283,13,12,0,9,13.25],"=":[5439,13,11,0,10,13.25],">":[5582,13,12,0,9,13.25],"?":[5738,13,16,0,5,13.25],"@":[5946,13,18,0,6,13.25],"A":[6180,13,16,0,5,13.25],"B":[6388,13,16,0,5,13.25],"C":[6596,13,16,0,5,13.25],"D":[6804,13,16,0,5,13.25],"E":[7012,13,16,0,5,13.25],"F":[7220,13,16,0,5,13.25],"G":[7428,13,16,0,5,13.25],"H":[7636,13,16,0,5,13.25],"I":[7844,13,16,0,5,13.25],"J":[8052,13,16,0,5,13.25],"K":[8260,14,16,0,5,13.25],"L":[8484,13,16,0,5,13.25],"M":[8692,13,16,0,5,13.25],"N":[8900,13,16,0,5,13.25],"O":[9108,13,16,0,5,13.25],"P":[9316,13,16,0,5,13.25],"Q":[9524,13,19,0,5,13.25],"R":[9771,14,16,0,5,13.25],"S":[9995,13,16,0,5,13.25],"T":[10203,13,16,0,5,13.25],"U":[10411,13,16,0,5,13.25],"V":[10619,13,16,0,5,13.25],"W":[10827,14,16,0,5,13.25],"X":[11051,14,16,0,5,13.25],"Y":[11275,13,16,0,5,13.25],"Z":[11483,13,16,0,5,13.25],"[":[11691,13,20,0,4,13.25],"\\":[11951,13,18,0,5,13.25],"]":[12185,13,20,0,4,13.25],"^":[12445,13,16,0,5,13.25],"_":[12653,14,5,0,21,13.25],"`":[12723,13,18,0,3,13.25],"a":[12957,13,12,0,9,13.25],"b":[13113,13,17,0,4,13.25],"c":[13334,13,12,0,9,13.25],"d":[13490,13,17,0,4,13.25],"e":[13711,13,12,0,9,13.25],"f":[13867,13,17,0,4,13.25],"g":[14088,13,17,0,9,13.25],"h":[14309,13,17,0,4,13.25],"i":[14530,13,17,0,4,13.25],"j":[14751,13,22,0,4,13.25],"k":[15037,13,17,0,4,13.25],"l":[15258,13,17,0,4,13.25],"m":[15479,13,12,0,9,13.25],"n":[15635,13,12,0,9,13.25],"o":[15791,13,12,0,9,13.25],"p":[15947,13,17,0,9,13.25],"q":[16168,13,17,0,9,13.25],"r":[16389,13,12,0,9,13.25],"s":[16545,13,12,0,9,13.25],"t":[16701,13,15,0,6,13.25],"u":[16896,13,12,0,9,13.25],"v":[17052,13,12,0,9,13.25],"w":[17208,14,12,0,9,13.25],"x":[17376,13,12,0,9,13.25],"y":[17532,13,17,0,9,13.25],"z":[17753,13,12,0,9,13.25],"{":[17909,13,20,0,4,13.25],"|":[18169,13,22,0,4,13.25],"}":[18455,13,20,0,4,13.25],"~":[18715,13,9,0,12,13.25]},"data":"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"},"link":{"size":19,"glyphs":{" ":[0,11,1,0,18,11.4375],"!":[11,11,14,0,4,11.4375],"\"":[165,11,14,0,4,11.4375],"#":[319,12,15,0,3,11.4375],"$":[499,11,17,0,4,11.4375],"%":[686,12,14,0,4,11.4375],"&":[854,12,14,0,4,11.4375],"'":[1022,11,14,0,4,11.4375],"(":[1176,11,17,0,4,11.4375],")":[1363,11,17,0,4,11.4375],"*":[1550,11,14,0,4,11.4375],"+":[1704,11,11,0,7,11.4375],",":[1825,11,5,0,15,11.4375],"-":[1880,11,6,0,12,11.4375],".":[1946,11,3,0,15,11.4375],"/":[1979,11,16,0,4,11.4375],"0":[2155,11,14,0,4,11.4375],"1":[2309,11,14,0,4,11.4375],"2":[2463,11,14,0,4,11.4375],"3":[2617,11,14,0,4,11.4375],"4":[2771,11,14,0,4,11.4375],"5":[2925,11,14,0,4,11.4375],"6":[3079,11,14,0,4,11.4375],"7":[3233,11,14,0,4,11.4375],"8":[3387,11,14,0,4,11.4375],"9":[3541,11,14,0,4,11.4375],":":[3695,11,10,0,8,11.4375],";":[3805,11,12,0,8,11.4375],"<":[3937,11,11,0,7,11.4375],"=":[4058,11,9,0,9,11.4375],">":[4157,11,11,0,7,11.4375],"?":[4278,11,14,0,4,11.4375],"@":[4432,11,16,0,5,11.4375],"A":[4608,12,14,0,4,11.4375],"B":[4776,11,14,0,4,11.4375],"C":[4930,11,14,0,4,11.4375],"D":[5084,11,14,0,4,11.4375],"E":[5238,11,14,0,4,11.4375],"F":[5392,11,14,0,4,11.4375],"G":[5546,11,14,0,4,11.4375],"H":[5700,11,14,0,4,11.4375],"I":[5854,11,14,0,4,11.4375],"J":[6008,11,14,0,4,11.4375],"K":[6162,12,14,0,4,11.4375],"L":[6330,11,14,0,4,11.4375],"M":[6484,11,14,0,4,11.4375],"N":[6638,11,14,0,4,11.4375],"O":[6792,11,14,0,4,11.4375],"P":[6946,11,14,0,4,11.4375],"Q":[7100,11,17,0,4,11.4375],"R":[7287,12,14,0,4,11.4375],"S":[7455,11,14,0,4,11.4375],"T":[7609,11,14,0,4,11.4375],"U":[7763,11,14,0,4,11.4375],"V":[7917,11,14,0,4,11.4375],"W":[8071,12,14,0,4,11.4375],"X":[8239,12,14,0,4,11.4375],"Y":[8407,12,14,0,4,11.4375],"Z":[8575,11,14,0,4,11.4375],"[":[8729,11,17,0,4,11.4375],"\\":[8916,11,16,0,4,11.4375],"]":[9092,11,17,0,4,11.4375],"^":[9279,11,14,0,4,11.4375],"_":[9433,12,4,0,18,11.4375],"`":[9481,11,15,0,3,11.4375],"a":[9646,11,10,0,8,11.4375],"b":[9756,11,14,0,4,11.4375],"c":[9910,11,10,0,8,11.4375],"d":[10020,11,14,0,4,11.4375],"e":[10174,11,10,0,8,11.4375],"f":[10284,11,14,0,4,11.4375],"g":[10438,11,14,0,8,11.4375],"h":[10592,11,14,0,4,11.4375],"i":[10746,11,14,0,4,11.4375],"j":[10900,11,18,0,4,11.4375],"k":[11098,12,14,0,4,11.4375],"l":[11266,11,14,0,4,11.4375],"m":[11420,11,10,0,8,11.4375],"n":[11530,11,10,0,8,11.4375],"o":[11640,11,10,0,8,11.4375],"p":[11750,11,14,0,8,11.4375],"q":[11904,11,14,0,8,11.4375],"r":[12058,11,10,0,8,11.4375],"s":[12168,11,10,0,8,11.4375],"t":[12278,11,13,0,5,11.4375],"u":[12421,11,10,0,8,11.4375],"v":[12531,11,10,0,8,11.4375],"w":[12641,12,10,0,8,11.4375],"x":[12761,11,10,0,8,11.4375],"y":[12871,11,14,0,8,11.4375],"z":[13025,11,10,0,8,11.4375],"{":[13135,11,18,0,4,11.4375],"|":[13333,11,19,0,4,11.4375],"}":[13542,11,18,0,4,11.4375],"~":[13740,11,8,0,10,11.4375]},"data":"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"},"asset":{"size":32,"glyphs":{" ":[0,11,1,0,30,11.140625],"!":[11,15,23,0,7,14.59375],"\"":[356,17,23,0,7,16.671875],"#":[747,27,23,0,7,26.8125],"$":[1368,22,30,0,5,22.265625],"%":[2028,32,23,0,7,32.0625],"&":[2764,28,23,0,7,27.90625],"'":[3408,10,23,0,7,9.796875],"(":[3638,15,29,0,6,14.625],")":[4073,15,29,0,6,14.625],"*":[4508,17,23,0,7,16.734375],"+":[4899,27,20,0,10,26.8125],",":[5439,12,11,0,24,12.15625],"-":[5571,13,12,0,18,13.28125],".":[5727,12,6,0,24,12.15625],"/":[5799,12,26,0,7,11.6875],"0":[6111,22,23,0,7,22.265625],"1":[6617,22,23,0,7,22.265625],"2":[7123,22,23,0,7,22.265625],"3":[7629,22,23,0,7,22.265625],"4":[8135,22,23,0,7,22.265625],"5":[8641,22,23,0,7,22.265625],"6":[9147,22,23,0,7,22.265625],"7":[9653,22,23,0,7,22.265625],"8":[10159,22,23,0,7,22.265625],"9":[10665,22,23,0,7,22.265625],":":[11171,13,18,0,12,12.796875],";":[11405,13,23,0,12,12.796875],"<":[11704,27,19,0,11,26.8125],"=":[12217,27,15,0,15,26.8125],">":[12622,27,19,0,11,26.8125],"?":[13135,19,23,0,7,18.5625],"@":[13572,32,28,0,7,32.0],"A":[14468,25,23,0,7,24.765625],"B":[15043,24,23,0,7,24.390625],"C":[15595,23,23,0,7,23.484375],"D":[16124,27,23,0,7,26.5625],"E":[16745,22,23,0,7,21.859375],"F":[17251,22,23,0,7,21.859375],"G":[17757,26,23,0,7,26.265625],"H":[18355,27,23,0,7,26.78125],"I":[18976,12,23,0,7,11.90625],"J":[19252,14,29,-2,7,11.90625],"K":[19658,26,23,0,7,24.796875],"L":[20256,20,23,0,7,20.390625],"M":[20716,32,23,0,7,31.84375],"N":[21452,27,23,0,7,26.78125],"O":[22073,27,23,0,7,27.203125],"P":[22694,23,23,0,7,23.453125],"Q":[23223,27,28,0,7,27.203125],"R":[23979,25,23,0,7,24.640625],"S":[24554,23,23,0,7,23.046875],"T":[25083,22,23,0,7,21.828125],"U":[25589,26,23,0,7,25.984375],"V":[26187,25,23,0,7,24.765625],"W":[26762,35,23,0,7,35.296875],"X":[27567,25,23,0,7,24.671875],"Y":[28142,25,23,-1,7,23.171875],"Z":[28717,23,23,0,7,23.203125],"[":[29246,15,29,0,6,14.625],"\\":[29681,12,26,0,7,11.6875],"]":[29993,15,29,0,6,14.625],"^":[30428,27,23,0,7,26.8125],"_":[31049,16,8,0,30,16.0],"`":[31177,16,26,0,4,16.0],"a":[31593,22,18,0,12,21.59375],"b":[31989,23,24,0,6,22.90625],"c":[32541,19,18,0,12,18.96875],"d":[32883,23,24,0,6,22.90625],"e":[33435,22,18,0,12,21.703125],"f":[33831,15,24,0,6,13.921875],"g":[34191,23,25,0,12,22.90625],"h":[34766,23,24,0,6,22.78125],"i":[35318,11,24,0,6,10.96875],"j":[35582,13,31,-2,6,10.96875],"k":[35985,22,24,0,6,21.28125],"l":[36513,11,24,0,6,10.96875],"m":[36777,33,18,0,12,33.34375],"n":[37371,23,18,0,12,22.78125],"o":[37785,22,18,0,12,21.984375],"p":[38181,23,25,0,12,22.90625],"q":[38756,23,25,0,12,22.90625],"r":[39331,16,18,0,12,15.78125],"s":[39619,19,18,0,12,19.046875],"t":[39961,15,22,0,8,15.296875],"u":[40291,23,18,0,12,22.78125],"v":[40705,21,18,0,12,20.859375],"w":[41083,30,18,0,12,29.5625],"x":[41623,21,18,0,12,20.640625],"y":[42001,21,25,0,12,20.859375],"z":[42526,19,18,0,12,18.625],"{":[42868,23,30,0,6,22.78125],"|":[43558,12,32,0,6,11.6875],"}":[43942,23,30,0,6,22.78125],"~":[44632,27,14,0,16,26.8125]},"data":"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"},"number":{"size":50,"glyphs":{" ":[0,17,1,0,47,17.40625],"!":[17,23,36,0,11,22.796875],"\"":[845,26,36,0,11,26.046875],"#":[1781,42,36,0,11,41.890625],"$":[3293,35,45,0,9,34.796875],"%":[4868,50,38,0,10,50.09375],"&":[6768,44,38,0,10,43.609375],"'":[8440,15,36,0,11,15.3125],"(":[8980,23,45,0,9,22.859375],")":[10015,23,45,0,9,22.859375],"*":[11050,26,37,0,10,26.140625],"+":[12012,42,32,0,15,41.890625],",":[13356,19,17,0,38,19.0],"-":[13679,21,18,0,29,20.75],".":[14057,19,9,0,38,19.0],"/":[14228,19,41,0,11,18.265625],"0":[15007,35,38,0,10,34.796875],"1":[16337,35,36,0,11,34.796875],"2":[17597,35,37,0,10,34.796875],"3":[18892,35,38,0,10,34.796875],"4":[20222,35,36,0,11,34.796875],"5":[21482,35,37,0,11,34.796875],"6":[22777,35,38,0,10,34.796875],"7":[24107,35,36,0,11,34.796875],"8":[25367,35,38,0,10,34.796875],"9":[26697,35,38,0,10,34.796875],":":[28027,20,27,0,20,20.0],";":[28567,20,35,0,20,20.0],"<":[29267,42,30,0,17,41.890625],"=":[30527,42,24,0,23,41.890625],">":[31535,42,30,0,17,41.890625],"?":[32795,29,36,0,11,29.0],"@":[33839,50,44,0,12,50.0],"A":[36039,39,36,0,11,38.703125],"B":[37443,38,36,0,11,38.109375],"C":[38811,37,38,0,10,36.6875],"D":[40217,42,36,0,11,41.5],"E":[41729,34,36,0,11,34.15625],"F":[42953,34,36,0,11,34.15625],"G":[44177,41,38,0,10,41.046875],"H":[45735,42,36,0,11,41.84375],"I":[47247,19,36,0,11,18.609375],"J":[47931,22,46,-3,11,18.609375],"K":[48943,41,36,0,11,38.75],"L":[50419,32,36,0,11,31.859375],"M":[51571,50,36,0,11,49.75],"N":[53371,42,36,0,11,41.84375],"O":[54883,43,38,0,10,42.5],"P":[56517,37,36,0,11,36.640625],"Q":[57849,43,44,0,10,42.5],"R":[59741,39,36,0,11,38.5],"S":[61145,36,38,0,10,36.015625],"T":[62513,34,36,0,11,34.109375],"U":[63737,41,37,0,11,40.59375],"V":[65254,39,36,0,11,38.703125],"W":[66658,55,36,0,11,55.15625],"X":[68638,39,36,0,11,38.546875],"Y":[70042,38,36,-1,11,36.203125],"Z":[71410,36,36,0,11,36.25],"[":[72706,23,45,0,9,22.859375],"\\":[73741,19,41,0,11,18.265625],"]":[74520,23,45,0,9,22.859375],"^":[75555,42,36,0,11,41.890625],"_":[77067,25,12,0,47,25.0],"`":[77367,25,40,0,7,25.0],"a":[78367,34,29,0,19,33.734375],"b":[79353,36,39,0,9,35.796875],"c":[80757,30,29,0,19,29.640625],"d":[81627,36,39,0,9,35.796875],"e":[83031,34,29,0,19,33.90625],"f":[84017,23,38,0,9,21.75],"g":[84891,36,39,0,19,35.796875],"h":[86295,36,38,0,9,35.59375],"i":[87663,17,38,0,9,17.140625],"j":[88309,19,49,-2,9,17.140625],"k":[89240,35,38,0,9,33.25],"l":[90570,17,38,0,9,17.140625],"m":[91216,52,28,0,19,52.09375],"n":[92672,36,28,0,19,35.59375],"o":[93680,34,29,0,19,34.34375],"p":[94666,36,39,0,19,35.796875],"q":[96070,36,39,0,19,35.796875],"r":[97474,25,28,0,19,24.65625],"s":[98174,30,29,0,19,29.765625],"t":[99044,24,35,0,12,23.90625],"u":[99884,36,28,0,20,35.59375],"v":[100892,33,27,0,20,32.59375],"w":[101783,46,27,0,20,46.1875],"x":[103025,32,27,0,20,32.25],"y":[103889,33,38,0,20,32.59375],"z":[105143,29,27,0,20,29.109375],"{":[105926,36,46,0,9,35.59375],"|":[107582,18,50,0,9,18.265625],"}":[108482,36,46,0,9,35.59375],"~":[110138,42,21,0,26,41.890625]},"data":"eNrtXXdgFcXW35ubShICgUDoLfReVLoUERBBEOmCqEhTAVGU3sUCSJGqSBFRBEGKCNIRkI703gmBhBLS+90vd3fnTN/d9z6fAt75Jzczv21n2umjKOKiGuWwp9pu9SG6+r5RvYmuPmJUz6OrVxnVQ+nqL4zqLnT1AKO6Dl39klFdkK6uqtemOujqEL36Atv1D7XqLWz1Ma36a+V/UJ6kAVFfq5ni/jlW+/mip+V/1eIpnvJXlI7Eqtnf/TPRR4Kc5249q/9e7f79q+yeF92ts7SfXg/cvwdLgEW0h7+s/X5K+11VguzpbswK1X4Pdf+OcUiQS4lVaav793LZa95yt36u/fRLcf/uJQGW016tufa7qfa7hAT5trsxPVD7Pcn9+zKLOKyal7GPHVIvAWnu2kHa72Iaoq2ERk201ura7x7a77wSpLbkPfTSfi9w/z4j68rt7tb1+u8L7t/zJUDfZHfrB9rvcO3hr0qQ9bTWp7TfnbTfxSTIYe7GBG/t92z37xssYoEFMdc8dkijRLtrP9N+Bma4f3eX0Kisdn1rG1PoTXejS5/pY9y/b8k6fZG79bT+e4v794+mC5I+JJzx7t/vSoD5VPwRNYlxypf2xEcMdP+Md0qQ04iPWOn+/ZvsNQ8RHxHl/j1KAsyRgT+ipPYijS2W+c+yMX3NIZ9bQyZbQ6ZaQ76whkwzhRTqPGPDkTj3Snt526w+T/MbVstNWfTATd41sia5YeRZKRzftQjEMdUK8otqBWmhWkK+N2oSJtWdm/3n7fDKbYcvj6IgMToipbKiTMF0KT34jxoI4ePSIe4VcIqYdKHGc3bLIV4G0TKelUKUS8Zt0ua0XCCBzKY/dUO38l7chprJEiRx09uFacxEAdkyl1cRiohUSR9GYZodtrF9PTv3Fo95hnlrR7keX16hIb8Ivt9Nup9mnUWQ1AAxJJt0PYxuU+tJIcq3BqSdHNLXgPTQqwN3tnawkHcMSCu9OkhVz40sS0F8DhiQKgDJLqfm96oZ7nRD+udrvcdARDlIiFay0mi6fKZwEKbczmkFia0JX9pgVaYIcagSSY6iH+x1MYC9PbihF/biuLV/RrtHevzJTV92KyZdZGZZr1IzrSEzrCHT/7/Lod1FVb40+/dcdiE2/c7R6U2EH6CeZpfY16KAxvvoKalU0bqqiWgThMneimr73V33A3PBe8z6QHZ1d23BLERfUDxdAy4p5d/gNKuTynkbc310DxtSTCFd8fM81Sn8Z98h1oUptE6ocobos3W2556DYHxB57RL9NnGlrFX/6egvqAZTa+KPltRupErUYBOrpwmn42u2GDwEvoVwbibzvAbqv5WfxjbL/FWlYSfnV3KaKD75Jef137vlMpk2tuqtYEZUdWv4G35z3aXL3EPhsdqv5tl/wyOEn+2JpqgUeJX/wQeJVMlny0diRVln02MHrhA09nsMBVFswXc23DBfk0I7kp8dt3JB2+nxV1a1S+EErl6/nDxYUbMnzObav8G34LPLr0Nbvbgffkzp8BnN4ol33iFTAVQIR19dqlYmiozzASz5UAA9VqLgKKzpJtedukMn11XZzTKuWt/IEcsXYIi3U1D8CKzVKsur7MyQRIu1ujtP0kN83VCzKdK+XTc2w9JqeA37Z8+/BXbcG9765tScb3hR+2f4dwFnYjedrpIAWmF9s8wk8/OLnpvGPzgZu2f3iL+Hg/yw/yXN2W5tHRqkGuTRF1MaETSczBXMPqWp3UGKML9+zvt92qR9omc2/q7X2rmX3iGSgjgUAJvkp/tLiXu0yPxU4Hkw8zthtQl3zGCW9l0wdyO2Ar4+wNZym4Rz+06kw/eSY+/vKpvsFCpNGzV+bvpyXcuHN48Z9ALpZzyaVpvD8PWDJIhvaaxHJAc+x3PT8mwb6i2sc7b9rFNUHvGtOq5fPPX6rXwthQ7EGFhOXPUX9JbjP0YYStZqz+HIuwr1liQ5g54WWL9YxB4jPWNYYdxdbXEeh1C4LRGFlDnGMw1x1Y0hYZsIfvrRkHWZHcAQ8NP0517DEa3wRPiOZ77JDsSNhvz0Nt4sy8Aux5kPADrS41Sy/j3TUoXrDEU5fYCeDxlHESig891o+JuASXvJQC/iZcarLd5EbV2crMvsERktMzmGgzJeB16ha+NxlvaxQ1SETihBoi/PRH2T6Niof5vVywCtTO+NSkXwj5gxNOR3FzCis0Mo2YcqljIQDMiAHsPrXWgMdhKY2fhDj5lVMXAmhlyioRGEkzIT6gSK9SK3SHk9SYs1659Ltap1UoRcxC5koB/aYY2vHkES1WfBBNEWt0mv0/eBpPuke8bT8rxfufNNZyxNQhwyVvm4HuVSd7omghyDBRR0eXJ+cavvtc6K90BHBVBfmCD1aQ6y7XtVX+3NAAT5UZxai4X7j7/4NW4jHsX98zsVkQ24QnD4hPyr6f8xcVYkefQtc8bmw89srzP6NWzaXAfYxmgB6jvDb36J4HtjJMLnFf1Wsb084oBHkJX7zbUUeECWVRVf6fBE4xqxjp52aguTdVWRKsfDf7AqF5GV28yqt+hq9Gm0pCqLYkmcm6qujXiN+l7oC3uBK/ccZeNAhsJbxpZQW+xqKw1qr+yhV4svvc0sfPPIPF7t0XrvCLsMjWUVsE+NKqfFQgebvW5mLtjesdwClJvMiPeGJdqKbr6UzEbi0bEDuYu+4xBn08g4fGjzdt46EnmLu+K3Zz8bgppDjOtKHN3Qw39JQNvbuimGZ27sk6vn4v+30Grc0GAMhaB0iKxFwyx7JrBdhriNJhpqfQy4M0Y0S9Br97GwBfSimvmHdVvGP452mAhgsQmWsaA2caoZmx2IcaGnMbc5agBbyPSNHLd0EfluGsFFB/ZveMjsE1ml/L0lECq95b0XRA7wmh8TxjVjEIBaf8nKrxqNrtMFaM/pqsRu8+oNxAP3o9+73Sj+gWqOj/6yooCfiWb4L5UdT+j+iD9xLmqcDs6blTTngm5DZk5PVi4MG0Wj7Ye9KiKEY6qRuIxuFg4YoMSheO7twF+jqaeIYXtEouoDQVaOEJ8MYxeBkkj6OqdevXnYq7AzXWW+9+19F8ewbbkmznZrcuOUTPmFiBbgsclqOnZ6E80meKTXKjFb9Bdd83K7Gmni0gPPgxwt1R4zZgSP2fPq5KLdfY50t35xpq60TC5ll5KW5u21SWUQ99jVnw3I4B3yeSFKW2jWIm1Mvubie+l9WUDvb7UEv1Gl92XXTTWH7cezPie6Hd93IDyHS/A92g0SBgXhGjg3f+OQYNsuqXPzkfSLXB0vEY3pd/yUiytw2ZO+Tt721P+uaKtNpc8SA+SKL+YKzzmPclIzwjxIM2RkbwO4O+vQurV81BTFA3mDlD1Ou+waWgc4whjm6GwJ8woFfSanQ5WEE0hRb01WtVHpJZGk8uPehNVmvEvk1SnYg27UYL++cp/T3kkBq+9KqO00+opFcUSLtjMeY+TOBtr11Ugq2bw0V7XOMVGDV7hMp70dyME6Hm8/q4FWTVYm2q+nGqScvcJ09j/jmSV5vycGsypYalQi0DNaPIWpw7Nyk9WafN9D6UMesD5xTynvXoEp6ugtVGafDSBrHmKsrJpRbO6Xqeu02TUmWRNad5Z+UNNx0muHMofmosOpRXI4uR2TS5OpjwQftWkIbImWLPMvcbp4TLzkFWad8l2ssZHW88G8CozSr+mWaSOUGI577ZdmzdFf8pvMudMbRk+rabtikzKTLjy27i6QkDQyBhiZbvwGm+gbsiap/awDvivpnPcUXQtWiWSJTKClSUQpRKEXNZpf069oKq3+xf1LzMWDH2fcDo3NVJ/xfrIvJoCRoc97JY3CVV8Tu9k2VI0mr1hyGB6zxhsoxFkOms/AN3jHtImrJfJqGqyrpBN5b0NwECtO8xVAToEM2uUW2inzBlqIiZUebisEKk/J6NLwgHyNExBIkpLmwEA0dzQZoJhkhhdAOns/ne+ILTTAZDXKAgx+L0A0lP2IF/6QdBn5zAkJ0BaUx9N7A4F6I/uAD7+vGre2D2qwr8hzMrnprg2PvzAgbkaQN4CF1f9f3A26MrZOtDUHaNyml6kK0XOpfBu19DALICmFayCf6hM7PMXzHOwelKNKqn93xSN7tSinPZWveOeauNTWO9s94KcKJywZ0mn9faiaf+A2l+Vnhkc4u7TzALT6AaD2FeKW6aCx9wlABffELpF+baesTsqOSvx6uaJ9cULZuk3Fl6QM3rOmoN+umPOC77Kfc6jD7m0uFe5c1JI5yMzOoTDVmPOAHsgHshjBomQqng6P7kQt/D/8rhvf78Sk5QZe+3Ionc5j8dib628y1x9uLeTV3mw5Uh1S4ia3NQSoibXsoSoR500JGPTOzVDvMOaLST2lK4kJG4yOCjWxnwvZvwT0yaRjvL1wfySBJLc6jI0ndbAbWTByJgdUKW+lDjeT2rm6ARuXCEyyHgBX0QXB4ShTbJ827SiEkTpBJnLNCpFQGY44itGlLyIEDcLiRG1ohEiRkK2F2FcxEgcdvuAPe66mK4O4HzVk+L38F0KiB25hIgQHDOxTPy1hU9gJ3Nx9oHKN8HzURKL1TSODgvhS3cQw+7UEiOGw2uckwRRy8PuwInlyYMoSt5nuoxctP3wuciHGSn3rh/+fkxzP4Yw4fzlCd9XsoJkT9av/awg2dJekCWEzCEkgxASSDYk6+CnXauGB/iENZhAiPiTsWZkXx/CRSrnBpURWgSDIxJmk3SfhQCm+1LIRyqniGYLyIA/yBCB8C7tZW+7VrBN4BJQ5LlPgS53mEUdImOhHIhQTCGZOzvxqhMacmFouGIByd72PvOzgmQvqnktIepRf/5hXjlLvTidkF9ke0COqdhhWrrZTKbFdlEJiFfFfoEiw+EWKQTc0w9JIesgcFeG8EMOgG7fBq1MeYchNd4LRhg1y9VbY4mO9yNCy6sDxO1FNOWV8vm8Awo99/F1lZ9Hy2XzNbO2JeQ9xQKSQQQViSHbSFNK7u6r45n2uO+5yDVn1b6zfj0bnZiVdOfSvkUfNPMzsw+MVmlNEV+qpFlBvI+oVpDRqhWkSpoVhHqMGDJatYIYj0mTQ4zHXFgih+iPyaozTwoxHvO5IoUYjzntJ4foj8mopUghxmMmKlKI8ZjjvnKI/pj0aooUYjxmtCKFGI854i2H6I9JrahIIcZjhipSiPGY/U45RA8LSSmryCE7GY9cKURWxj6ZELbMs1gZHguIxBNk+b8Bcthk4X8EITem7bqekB59fudnbUOknAbm4GeXsYJkr/MfOKwHw3ofa+p+67CEkBHh2ZDYtUNalszlnbvaACIe8nYgZozmNMCsrWMQdj59R0am3gDZKCUlKP+TfWWQN+E2xWUQbLt6SgYB9xMifQZTsAGmlvW7SGPWwDgXb9hJSm5gorT7wE1WYCXa0YE4nNUxEFO3C6lny9rzWbtyeb1Dqr6LhXz1uNNKFedqaKmt62elosx4x0qLeYzyoqk+ch9rbNnZ1Ztj2usOnLvh5O24jLSYC3tmdi8hn3M1P1x14n5q+v1rJ/9YOb5r9RzcnQZcZB7HRPYorW9yr0xDnKJETRTEKWR6Kchc1QqCDSWZP3Yvk8s7T4XOU89QkDAI691L2J4iJi3E/3yJEGtk8yYfMqRdCJbR9H10k45SsqO0VNdliSyVMJc4jIEoL+Pn5Oix8OTd9NiLW0fSeavGIUjtcUTOjv1k1AXQnol3/cqPX03YshcshWelPMVKB+lzIy4o9yb5Civq5wyo8gUM9puGLEyE8BqWzI6snvggVFz1YWVLPT+IsoWXn9szJvYVAAHPkyIwax20wRevbF4uOp6vtUBvnEIbpAua3CXNqLgkfxfkETBK/kWIJyiSJaULRLSslVE3HjRNxUFnu6JeMNlHoxgfKL5cDiRmvXADvV+W0mJs5BHRTFSc9ydsfrCdBbi5Um0Nacfe10447wq9vfxEbEZK5ImVrC1luXzsHnu8IKusIXVlCw44quyRrkkHKA8OUQHnlzPStQ8F0KqvW/IUt6T8zTIEGSJDFEcD92FOGeRLKyuJkgf5MKUVkEHGopsskCFyoJwFLqnpaIDKe/Uy8+CaZQd2g+glaQcet+zAltYduNOyA58G3x5pB6KTASTJvLJLmSzLDvzasgPDkQ9XqrQDP7XswJxIM+kqK4N8yJsqWTMVbH91LBllaQc6zll2YDvwzHOYSGO5u03ZeOFOYmbcrdOrJ7wo0B7W/ZX2GYxbxPCZQYI1Jm0slYn1kHABWkKo4X+yNPw8L1vHksK4tUDd3SqPd8HXcCJPsNQBb/izzveHXmYnXA7g+4uy0+kIKw2d5ew8aJvOw62h4IF3GtXcY03ABbix8yP7Lj0QBKLg68NFOjnzoq9+gGcL5Hz+vVVu7wKvXUX/EnmxfX4Wyj4fUoNu8EMOcYnVSIcOoTnMA91YucW3D5OuNf0XRqpsLGIit5NG7l5ZwrFwD9vVnkfMlevbxrl98reFxSoajRdIHOQynC0cYMxCjsldOJueE0289ALMoMPC8zDKkVJRzqDnePNeBEZKnLu8b2htBPle/z+av0tzBDFy/oBcW5M34Rnh3b+i/yHnhxOYekNJCqmqsoyEtA4s2hnZcEoC/5u1sGEu73wvbce8H7rvIinn0Q2krBgJgoiPrnhHiNhDymWlNvOArNmM/1C7zTQDmbhMkPc7X/epm8/fTsyMjzy9dkK7HML1u/HYLWeiM5Kj9sxsK7S25BwSRTwmdiLvi9CYzaAW1YJBDOHHdxad+KKXkCykga9ehthdhzCTgQwV804x33ydzvL0B+kzRhemgw9zvfgTqxKrSftGZ/MsaN3AYQ8wVMszrN5RePRXjIzyPM8bjWIseK/y1mgQ05P1Ff81k7sYw/sF3vV5PuOYVR39mwqizjFGHeSMZeXeargThjHSZ7S+qQZhoRaxMg2xRNS/qE9YBzI12yyWk+bLNCQU3pZCQJJ8Ks7a/6LMKboFrKgdCD73Q2LOnmo9Av2kciH4t5156EZyStTeKQ1xBuw0HymjgvRPu6SIGug5w6WQH9AaKtWV1UMTb7NUnoDZTWRgONKHUGK/CO54ZC7M7C1j60fPFw32zltjEO7me4UoiMj0TOVIESGy6JSCAkQcY0jhEZtLKqaQrC285jfs2X5fbj58PiohK/n2/oVvFlRMnCb6Pj51j2N5HOnsGRv/vrGBDikgczAh34uTPtxqn0XEl5SlGVmtGLmBLpOMmsGOkI7Ljnu8XK/v4FEUc/YBrXzVykbS1GSreDX6+hM7uCqf35QnJyBsb0N1k6IFMnfvXYgpN0P6v7KG8L2RIr2aLKSZAQmy+hRa2sva3kfkXF18+Blartz9TrhIy9Z3D53ceP97hQWwgE7raJ3E0Y9Exk1ns8W0A9XJkaXFX0GfFHN2XHkr47Um+U6qqlibudXrk2tZdDBCnhhR2ibS/clDS5oh6S86NER+Bobz+SU0lfYPllpnlYDO6ynKu/YOLCgF5+m3l+7034WdrpcSI+gRkrWjXz45pzeVHnWZW3vnkY7kpotsjWR9dnRYm2YP6dZ09PndZQ+ZXYoNO2UT6RaGJkfaRGZ/X+MFn/xv9w9PwpgnqXh601PMyzcznrY/li6OLW1/1B0YkN/2+Mzc+GqQ7ZGc9P0L3rbHfMwsqeFFKfTefsaUPb6sfE0fwiiyDw2Sb3Clhh+n96zNPaSuJUq5MfRumLy8tVwzUnniBVoJPqee3OJT/dMrQv2Q2Hw39YbteeSoNzPK5oyrNP68HWR5kghyZNlRJ+18UcRw+rS/e3Pri6hU4qOjNOV/bOMj7HrappW55TVRbxYZzAynw++JzI8FBzLHml2eUM7OSL47u66t2fFDKzuzI3NTd1sz7uBAW7P44jhbK8M3M5/5x1Y63wrth87dsP9MZFxm/K1jyz6kohensxvJ8fYmjaq6MdikUT2Qw6QRsjUIGzPy4sa0dQNrhvuVeAVHR7yBGq9+gCQvJxh5jJMkhg/0FdiV1gooAql5Race1mNuS5VvTTxaIZFFBs/TP5+MGhdzbR0g8UokJ1X2BwtJIue2it2SErlDU/FBN3drs221gPm/VoZ7GcgTc5WXj8CnM1kgOoJRYq6AbB8JbLFQxnL+YP/7YvrMf0sjIV7V+uD7w3eSMh9GHlw6rLbTknwVp0VRkzd2gTkzVXO9i5/xfzSQq3m+zpI4YEok4LrXpZxxlPBE4W5Iwk9eN+L50nm9c4TXfn0RiuFM68Rf0N/4goOvk1ugVzMj3j6rG3tBZ/2CSx24W9XSDSNpTG7ravo68I3IHuvUQ+nvUgtEDo3BcPWXELF7JmE018skc0cmwx2fMMWU0NYKyI7edP6Z2LQrC6sbm2RfZL8kLNmac/Nuw+mlBDJZu97HVwRq3ijglBjqdiFNNzalSoQBbwBcoZuBv6BUroaaMw85EOMOwRV+bqP7n+iKnYQ304/8ENFVt+7A+ixDU6odAm+YW408R7uaBAU9u5m64g3CPqZlSDccSeboZjFtHjmWkFdods6XdZR2TIhxRshF0is18DZxhZY8y0hsqSVp0odfmAZZhD7wc+KKksT+5P6mOFIV3JverfriJsM9ZDX279GPN4cTAJ4hruhMKJ/dV1wnr3gJXVGHuEJLXFgSv5URj12D1p23w/96u82rV0iWQefb8lG+K8bppdoVA8ldewDhraINuHhj6Qi8A1dU0XSCiDPTLO9GfOs8sgcXQw82uE3Z1LXDE7Yaem7DXbdJcGADZKke3PR7bQ4mYD7XzdJkGereVdI1K5Nwah9GmAPCSDeR+4TiMYXM4l/c/VpJxv5dNRqjemN2+UxlauK7+xCy6kegBBJZ7wLbfPwNxgvkKW15g8SCzRaci0u/8k1VbWWIv7L6fUGUjTYTMtpw9bnyyHacfNrLp7b/D3Z23SMqa7ToljX3CHNqGEff7OdeOXhshrpVKGUaGd9ca5uQUfbFpmpKWPFBpR+iLfDW168/nc/fK7hs64kHjLpUca6Ptg9kAySxi8yOskF8wVaTuJlWR3j86XbmZG66jEqQmLqmhcOya/ybjF59/G5KVsK1bVPbBVuAycNqI+QwUtydIEVVo5w5pG86gyJBUwnKh/bnWiqBtWMcOCUfvJYh/JtCVBib0nK3OdHumZIOES2luxnpgGirfGNNSDcD+8YskpMOiJYQgF2clsqJls22OGOkpAOitYLdVkA6INp9H4VwMdotI5qWFMJxU0I6GGl6qN5UMemAaLf1heEp8aibwXhG4qCYpsKRhoS4j0WkA6JdBWWZaNSt5d3HT/GkC0s30TLvFk5PvkSIpidfJoimJ18Q6WaYwwzS+cRYwJaKpqfA4zqYIhpz2heEH2mkw0QbwAyuzSTpgGipoaywQJLuGO/fZxS/B5h0mGjPcdNoFiYdKFuu8nO3Ok06JmtLRuKtY2s/62Ajt4um6G1lA+VWIIXYQal/5rWDIqUbE5Ram0dl6rqxiA8TBDpVBuVmfqGHz5mg8FnEqWYoHCIcYoLCIzSvCQo0PRneJqhvecdTHoUVQyNlKJ9SH4Ad/UGoDdpnvmSjhx60tTEm9oTbGl833vKyNSZ+DbI1cjZ5SSjhyFmd8IDub0L7XGA/uemUo7Bjp9rABKXAM983Q4EVZooZ6jY78kUo2MHgnAQBKvefgOokoVdwtY+wcJ+WywbtsUOSGSqusA1UYksbvX2uluXIcR1502kyCjPjos79Ou2NQlJGtHSvedsvxqZm3Lu8d06fCiJE/hHn6Hue/5RNLhw6NVXgHvsTdbsXJJ7QYwnMcJdqCZoipRYGDVGtQfXJsIRTHzcqkSOgYKXO0w6TIB8iHvp6F2K7KjvxLoAGEtaGMJouQSON3FPeWBt4KlDWFfgUjZTK0v5azHmhCwqkfnPJbUE4MPqo/EaQyps75pIoePOQ6/FwgJ48co4M+a7//wTZepytF8ckmCkHFVb52AWTbskykR+X2HkeDnxPkZ8+741zR5wIsCPW/sFwVkEjUOo0XyJPxdWOxESIGB+Dp1RDckqdnNCwWA7/8AodPt9PT86hNianGWs9VjgWTEBKm2gbICXPjDTBIraKXRMLjKLN/uqFz4S9Wbb3/J2XH6Zl3L+yd27fihJOISs9Iebykd8Wju4sdHcQr/nRXzWyiXRP7pfsIlX153C7SDWyul2kmlDHLlKNLaeI+Txnnohmo3eQu8PJADN+tvwSAjreDKko7bGfYkp+UyQ+CYAQssVIYgG6boH0x0xbDXMkMdwHWCAhPFVdaIH0gW/aYYGEUEj1lBXyNKsAkCLB1+SKFTLG7tP9YBnaboFsBFT6xgKJ81q+Y44MxMJ+dXPkKLsjpGWmzVHXOcHeSK74nfXscIaWajaaymd3KuD/M4uFPHBdmyvDTburzar89lawg61srYpRc+qbrbSujKS7V45sWjiqY4T91Vsloo2fSESmjNN4IhFsebIR/66+/c97H1jKfwXCs4551jHPOuZBPCYIouR9ZdK6Y9GJmcnRlw4sHdle4lgd1Hsv4/XnOj6F9ysMGCr2ijhGZw5R6l2QLrWUn/jbGaot4Bgz3poAvq3aAz5DGlofLH2zSiH/HAXLtxqxIpoGehO5MB4OpZwP6356kwC+g3FnOMde7877kOLaeRVwV3KbddsL2L2jumn/woEIQp9pooCKzFXGFFcI96r5DW1pTG0rH2lNQhuBqphwYhYpRi2A9cyB+NEvmgPxx7xmDnxOYNsUArFGlT3TYjrjug1a1cxi5kCsE5pqDsTa1cQypkBCw3oswAxIaVnzmQFJTevNnk45kNa2Xpneukyod2ipxsMuc0AzjSsNtHBoeNXu4vOqHe2r25JU01oDmz01f+VduTgtrJq0rrckJhppYmOvndg8vVdtf1v7Bk4X3ciD9CD/Q6SseJCeEeJBPipIT5Wn6pGs8tR6ah/z2n6oNp2shbDbGLIWjh85S9aC7xXpHt9GID8qlaNZEdkR8szkJKhM1p1aGddvwxGRrk3IJ6jNQj5EZG0mnD5D1F7BAjXUHu9PeHwdU9PvXjq4oE9Vm/qrYpexCqWACbAkTt18Ip/JHctGYs+QPGYmYhzXtT+XyTtWw0dgk6mBOeBTWEW2PdDkq+tiZ4zfAkzI8yw2da/3M6FjMwhzV1f7mBC8FXZgXO5t0jPtsIS6xGnShZ2wDu9rk2NPM3tgIX62w0w9nyVTXki570k2Ff5jbVoGhto0Ibh62rU1uN6ya5SQhBSLZI6B5kBCafKBqRa5M6GFHWaqbm5P6E3HmM7rNoR+Y6LpAtAyBSM/M10piBHO5mBh5kwj4pT4Lx1ma099IjXdPIfZIlWbSE3/jZfZalaLUJJ/6zRb9og1Rf3eLIZAqUSollZ6my2k5Ymo7J99zVbcMniFVH/xMxMyShIh/pv87dggPO2edk/7I9Au2QSfpPbfmW8PIVZ/HA5J3ZGxqb2vWl6xmLrA66r1FalUKiI65lF8BXnwGXvEruSKKILVq6rauULtJjIeml5xEC4IS7V3BY76G6VaXWHcEgVc+kRR1aIrluosYoYR62Mcn3Pld/kVY9dSrIiRHf+9nSZXNNH/3tW2uzqGzBRidgU6ckJLmLUcmUZNr+iFLa2FM5B11vQKfyO8/FlF+UT/tUExvwIlTFitBBjXPm91RSH9XTKLv2UIZA6rK9DBB1OMVHl9FcsrjDRhBkv5IND6CnwqnLt8rti4oispxxazc4UPkfn3J8XOFcoIfEUDe1fkBab3qGLvCuUbxu5sfQU6djfaz+4Vyg7933GK7Sv0XDborCI7VzDFc8VfcgVjil5uZrW66msXScmY5siYYLtIGF7WyIT8dpFEkKAVMr2UXSTOAmCJdNWwi4SDX0yQiL1oaomcaISsHnJYIceic1w7WiIVI6noBW9LJAos6WeJVIwzWLVDy82RVY34p5GWSBT1H5fHElncUEl8YYlELiipxSyReQ39wRJLJOKEsipbIo00WeovlkilPzNg5Eifi5ZWarTqdLKNdBy2izTyk9lBKpttI2u47CLhZCZrZKl0u0ic7MMSmT/BLhIftk0gcQnrMm3LuQepmQm3Dvzw/jPyzE/enXbSLp23p0jyULW9yEtZmXMEp2wEfycWyW5zWVDCpclnMnvRyNBzJo4Ub5BI5y4zn4sMklQEQ6YeGFgp1L94i68J+t/AeVCKYO1jHGhzi2zibCcKcQQsFc3ljY+1hINfcyeLN2W/85z2tLdMisWnkaLzDtcLvCP1AkfdqXoIrwNUlffZ1NI4X4Ce9680/M+dB4yTYnzNuKRy3IkvzJidzFd15gbRefq7wE6mtuCgcIiZnrAQEqoKDibeChYwSyisLimWL3CAfoE+AO1k9VkvyPXkLLHKYHUtC8VJgvSUmw6wGd1jOxarMAxrHc43yOYFwHPTCNbG37WTRmIfVhSzGornC5UGz/csPzoWYDaOyMDtxCfxpoIbY1GsV4iFg5sKE/n0CFMQqVHY/27F3H5Fm88ntPg3iQOXnHvMlozMJuQX5L1gAu1N06XgSRkwizvKK0RyQnp0c8FS/MplwWt+FSZctn26/k4v8He+KCXdDZR83WZsvRCblpV4+9DyIXW8rDWG6Xcv7Zv7ZoQtteKurl52dI+7S9tRUCY9awOkxj9lxx3vnLcdnz1JiLlPwXbERnBGrnkl8qKUkKtn8bjvIQfhdeMjOagkOy1EoFLsFiYCYYf0D+WgVTZefAAmQXEhyLtA240Yc/q/6hZRB/tYg/DqIwelNLEedPuso733dDebCBn3Lh+Y/1aZ/0yT7wE9uiABVx518MeP6jvtc+X3Zpe3z5W7vitsnyuP7WCfK2dPtA09azLnKPcI506zKewis8sNN+fK72JdT2ErrhzHOs234sozkdSTK8mSK0f+B29Zc+U3jZp1Nrhy3QXKEWuDK9cD6SLscOV6Io+W/zRXPuYv5sqTmBdoLufKbzPca0f5Z51jdtcRcmLp6rmyAP1RzpXr268DuM9bXlKu3Ng68RhuLOPKXYYYiYMZV8u48r2IucPeNs9JuHLgS7/FHGhZIVd+y0+gCIl6UcSVEyexfExM7u19yrNc+W6CMj4HzZaMh5SWIvyKHJlYj6ZL0TPSe3LnUORaIUYeER162V6wFD8Y4ide4DtuZYJaU8vJt43cr3z266l7KaDFOhFqudO0RKLS4RBL7AtoXOwNssS+iLDbAyyxrRF2k68l9iU0iNZ4W2LbIuyPThkTlXb/xp/Lx7T0s+fwEP9tKXt+EekTHPbcJxY4bMGI6FBTWHSALRgRlcpwJn4FW3yHlaBzzBgYvFBuMoM5zjG2SQk79A3LzIthkMVyjylsIa3pkL3bRWY9FcMgHDs+SAbzLdBymdA/Ut4L6512YN8F2BhI5162MSxdU73tefWcfdreIE9pYc9HKLGijBN2FKgzB7NRx7xNGOby2I4+2IyvrgmbzINcZn06AW73sRksENwfE/OZjTe8u84wg/mCYSW1qJlo0BNut9AM5oS5lVnWTNDoCLdbYQZzQOpfV3UzsQWL+b+aSjd/MH4Mxpb2/Ki1Z24lZiZEX9i2ZFyHsrx0k2cSm/I2adto+oilV4Sx0YkkZJBkNBKQrqolJiTGGjNOtcZAfv7k+W0iAp0hJesPWhZJY4oAd0RwUo7an0cRmMaiDcE9sLrvgt9gbzM5z/ANieua0MdsgRxTE/O10nyqTsLV+dTMruW8RCDGdyxhz5Q2XEaLMnx+D9eu3rlokLDb48bSB0+ME+ZLvlSNArW5KuzTKhTI712R8vaKP0unkTtSWJDg4EGfmv0WUTrbPyU0LfEhPunUJeXyAlbyHnRcyQlCcyt5P4NYbmRFzb+uBocBhzmDkQ5X1Z+Zs+Sxo1IZwGQv/AMJ62AISHlx3gQme205MqNDjSIBPmENxkdzAm24CbPTzRpz3MsSkwZrmBSTibdhvwliQ+T5Zyl6VB27kx0WxwbxkoBf/benbzh982FGSszlP+b1qyh16xTxBk8SgiTKdxIrkwfhQXgQjyNCzEb2gunv7QF6gB7gfwfsYwF08kIRKY8PoBXqtK0gl8gscxOq4ARvlWSwvwItJTbUqAJ9jLIPVW7EdTcF6vR8YAojAl/AXSIN+x5Mhsc0EUhEOL67Pcgb8cRJvv5YIowZVjWnT/5WP7oE/l3ZZbSck0mnLG/BUlUzcX6TbkeIl+DWsK57DcXHxmzlDy/Mv0XA7Y4VqlcbrsqkYPdnFJWaMNt8svXkzcSslOjjq8c0ohW7M1hnNKJUgZs3xeei1eNg0IfXvbCtYx6L8gKt0QQildwDlsNuBg+KIE+AY7Rq2NahJVZYK/GzCgR56k1Kik6jD7yGU9b10+l8IHaXjtj+DVUvZUi3j7JrQLcYLt6YdKQSYDBBNMZMRDjRK38SRNPLe4IOq0QSzehzIB1OpPgZRTS9rOUMr143KaIxCohY1GFNaaIZQjOQDp0uu4ghGkM6Q2gMiGeIxpAuXe+wLhzRGNLpRtZfOaIxpNuvzbUMjmgs6UqTSgzucFAgnfv4gSMCojGku+LQz51micaSrj6K6xIegwqkm++4LiQaQ7rYFhKiMaS7LiEaQzpVQjSWdDKiMaSTEY0hnYxoLOlkRGNIJyMaO2FlRGNIp5qdkktpwRii9eZUy27FjEtkS/+I8NEoB1oy0sLG+pdpZQO5bIOupgAGwImr6i/EWo3UhCl+pJdYJ4GrgBrrxRNuF+U7Nxuvx4TWsArPz0ykbPAnBHsCqalbSfkRwCu7QFc5nrgM8yYoKUxmML1WgJPHDuKyKNjswYys/w/pSCejMah7hhsqpFIsTzdd/78eeMkYACP81Ig26Mnubsa254vczjOMvDNGUtsSqYS/iKKAkjQf+ymG74DuOXxR2W38pTm9cxzhxpPuLQuRJ4B+wlI32oec9F7YQXIPryvN9R+609I8jq2EQZHsS5hvSilB+kaqnyB2hnHDJJ1F6mHm0t1fh7C2FqZSpIBb0ZydbsHo+EL38g0hlx3iqNjWpJ2lFB6LxrRzHy0/TcA25EZvEOcFpiS301Aevf6T7J8QaFNJ5GJUHZlj9Xl2ChlcgxGb8YDkNiFqZaCiXCBmtX6ac5q/ApvBOnIdAjPFT0p+cg0x9tuG2AdkCHlZAbB1K6+QK1ZB5ImzW6zyBlNvuZlExyuKrm7/zR/5QST7iO0Sb/1JDDPEYsQ3AScVepEFA97aLGJQK8rrBssoYrsUwhXX6MFmRn0EVcufExxJO4aCmfoWXc+eoEgFMRFx+bSP+QF2c+lHNWNf+v5U/RT2skpUc1tJPXvsmuK4R9p7sKXAcZ+sz8NtgWtU3kGYZQNO8zsnmbxhno16ozwlMDiY1SPbGOGxWNS6vh6IuHPp+1RMpYTkT8QOdz5HQXDTdmNf4CZukTakiawLXGW4+3KMegZkjmWoCqc9h2iOHOAzFwlaAi+wFD0oyK4hrmaEkSuB8TB5DibALLESQ1sEc4EscT4HRSRwrkyKIPWQmc8w8jBwdn84lfYqvS8R5WXs/ocvOezD9TFsrOmgyUgReOmG3ODY3UEi1q4Ja7vcLo7am86YQCWSuj+te+ghtfSSxtfVcs5zLmEPKyhF5Se55/FS2Dpq+XpKgnqTsRKJPc6Ks6oT4TGhXpwRyiXi2fFqAMbtG7wDXQUw7v1cF2bLt5wkAWJcTD4shXHahwnk0oln8l36DA48KxfT6wK19+JZabz1YKFUhGeloShzbAeNWHFA4VkJvi9FgSo7EaeOZyXRPz3gse+z1oFM0gsJ3ElTddunZFbmBZ3XER9qkB2lZ+ULlAi1nrk5LvOJJaIyOMWmMCEXwXjidlVGYl9velrOVgl9kTcOdO5HguoBKe+7uxU/M57QF/qdJZ7nLiNF4tTHKqOfIp7ZFezPGdTzFOqZd4291nmYX9aJZy5j135CH0Y8U3MuiEjmnkc/80a2gOTYIXieu4wgHRP7qBL9G36mq0EhGIf32KNqKsEzz2+QPI9+ptni532YBd0THY1TiT2moYtwpRph+Tz+mfckR/HQz+wiXWlH2FrcvWHZic0vR2F567DiQXlQFqhq5k4fHzyGmF7WmA0yHd8i7CwnUT0Sa22MJAmD0hokhTTZae+VE1SJNyE2qeHsyJ9JIH7Yy3ON7JOWYu+mQAkER3PdkZmU2sHmmCLzZquWyO9xTAm/Yak/9ceJwX6SZcT4HiBHckgg2Px3q5AE0gE+KbmWBFILtkxXBwmkEBbzR0sgOfBm8b0E4sDOgvv9JRjMg94Il0C6YE/JahLIM8AWu9pJIEVum08wb4E+X4TZ+RhiyGQLeMX5Z6sZjYen2lP9b6j+ZyfgOdLWo5dPWQsc8q6pRC3lUYwXDOK/jlBVzTm1o+KjCUwDeC0xrd/WdPeZlN95cBrPSPzKi2ea9TGZ2jLzZ9H6YHfRmIolPNNzn3JL0dMN0dGYp3nVjiYKXxeoa6lT9Bw3eZ5AU4CcpKqe422q3rFkRxJ6jD1UlWauyKLkpkBtJ6Sz+a9HBh9GwZVKcYNhWYR+1ii7GfMR0uvE+fI2Bjp26wQ/BzR7XBTF/ujB4nUo2DWeN9Qs3heoKj1spQKl+dbU+nSiAO2gSfrYSs3U5XJrPxbQE8Qwbv4T1UbZ6an2VP+Lqh+5CWiUSQJFqmLmT5TVyQLYA8SytOdNga0Jo0jiMybABsmU22QFKbDaQ/qTI4tJgBHIp2T3caTHFCf2KmDkPHB97u2Pkg4eEWkWchv2//tadPirhii9gw9HyrHXEBMN1qG8Edz4MxvK6WM4ukwH9XuOxSrlPYL2Xj14+iFl83hDp9nnFFI33rN5FSrr0VYfctL3HO7tg/RHvaF4iqd4iqf8RUX9J4uiPJvIuD1CMVoEpp+GWktieVnL6UBZyzLRFpco24UbuBXNqbVkLVdzy1rWOzzjylM8hSrOYo3emPDdrpO34lKy0uOv7l3Un/FHUD7gF4jDXRwWCFXdVdAKoV7MbYVQtzisEERqu2zEnWUDWkSEBTiDyrT7BpxV9gKi30IqKXkFyMdSWEafrozzGl9CEeILy9V8OWU66jntl7NRD+ksFL8Ruor9wrQS4FcZtltCkGMGIO8l1QLxg2qBADd99cRb5QMd5LcYCPDcWIu48iAGsZaLHarOIPYjSQq+fSKDOMa6/ZeIYxBbGK+hYmfYb4FcT+rahmH+5UfGcl/7rGpFD4XL2byYRVRmHMMOBLII5TkKsidU4RBKBDbtpH7spwgQilLni0PR6cnXNryXTzjokI3uocns92D+Ykze9zZFpqbd3PB2LhnGZwwI7/FDvISY3NRhApuDBJggJk3hbn8es5Idq7M5DF9cDQWY+OFl/PO+sA3+P85j7ug6bAcOUGrAYZD2wwuqvmMxWMfdBnvmM5h3AeMbx8RUAKYWr3hSX2EwhNZiPuM/hzBkdDOEHg6nMQkEZgzCfPKf38fO+9j6LhF9Skrp3FpKZ+gvx0HWN5vrdyP2RA+14MfPsDJ+eVpAKh5sAzEZh4248fwTi5nLj/ngQzRks2BeKKHU/NoUYDVP4/pJJYewwb/dSks4t+61nMLWtlN2no5KTb597sDqsS9HUHept4rOtUxmUSywmaMHbm0hyCEGre0zVHlrtRRV3uo8jqvWdS2Rw79Aow/3ulDr69B2F+ccKvm1MULg0gSB9FdWFQQVQYEojxhRytIFlPsxW7YJvV5R+ZOPDSHKGVnwi41rzZ9r/s7wvdGi78X8Vl/RxUDn+DKCVpxzIBo7aRX40giB8MYpn9U1nYvl8A+v887GTBgbNVJNxoaidMw0a1Va3TNrVQptN2tVlIY/Z5m0Kkq+l7/YdeZOWsqd8wd/Ht++tDyetZZJTI0H8//CFBu1Kzoj6dKKbr4yTPBcGCSRL4sxEVSy4qkOAaboLSaugsc4D7CjaQGH+UDOyyNMHmxFWVwnZ1Ct2Vk85gPWqbFNJoeBs1m+YmxIGFMMtrUiCBOSzGAggvEPTK81DOZzgaw5lMEsEiwh7RgMRAwStqvGDGYrL2Arz/wX94H36SN/Hzvf1ZkX5zn6AJ2zQKDPmSztr3mcuAlVkPTeZaTjb5XBYfLi8bOodnBgzVmC8UPkipeOQ8V5iG36hp8XRZhk43NF86sYNb9meQnnaY4pMIZvd5HO90KDd1xJSbmy6jV/M/VR2d7fHbryMC3q+Pr3RBk7vTpQHN4hLmF/pdPsp29mEpsk8YS7RHIZHYVakjvYR7ZWspj8fyCFhRdkU8385tlcfuXGwiOHGQjwQk02uIUaSHlwN5DZmV9Hj+2OavRTSiFE/TRwgV7Id3gbzWIR6f9RsJ+WxABLBYSPEgTm1KPmg6h0ECowyKKtGKfMECMo7khUxlIckhQBkdBlZEPrXYToLkNUhphF6fg8K4tVabTGyFULuZbTehLNJT84BsKWH55UB/pXy+XMWezpt+Ycp8SxBhmyjwWBrbclQumaYIVQSh+2QiiOF7Yyram7htdkJJgiXWbtPReTnhYbeWT19N41uDBTR5MpO248NKYWeF4/Ty0vqPp9+mlGdQuXqNrBjh29uoYqrIY4wmstyXBICP6g/b3h1AQ6UBQC8uiF7BeuOkhE2Yn/RLXkBT3VT1i1NhMHb7+cknTppx7SfTZ4Ot6vO4v369LXyAH0pWjfL8vw1XN4jP9Zaz5kmjU/UwLzQUvq5gx6SsRXQ84elxEi3iqdxXg9AD4GPXwUi4GgqAzQgQfEMRhY4Ddjei1lMF8yc4/afwwMxOgQ+8QLDAZOkSNcj+rLMMTqVZfBwOkPRAB9S9k7j5G/M+TWWMvzFAgDKfKSQdEc8JDti7vcw7i+0L3JtZ3UOBapJdenShEYypmzagUF1hSNDawhNeGZ/U5Zy4BKqZuMAlw0d0pSjPVMB/TXl8QcDPyC4plfZPS8Rik8eDvmmUF0fEfOPq831UJppTh6cAbWD3cbSvlgO7cIhnhf9VIf7HGRFx/Q257EqGrsktcr5vXOWbL9fBztdtSLxghKKpmxXYzJojKUCDGxryhWmE2Madav4y903HPKUlFIYo7mH68+GZ2cGXv12JqRzUM8FqtHARPQc/W1lKRrW4cUkWJegwxvKR97CzF+y8jeX+snwPhtknr6AmYpO1pr2rCOLbGBSQoUYBJGlffP2z2SM44RmNu6JFQ4hhYcKQzSvUPk5DQOA7EerVDNQg4DRwzC/vkTh4GYFDirdQ2HAQ/dIlIMPmykoBSDx0+4B/OkYf6hiv+iPCqv7qn4C3r/Ua3660anp+oJrkJJvB7wFuuruApZXfG5TkV4gW88428SUHkyCF0a50zlZ9RzGFJVPbgqY7UnqraGMFWJE5BO0V3lenjp57fD/lPm0QP5eyH45LmvvcQQnAbsM8ldsOz+oeRBoPrJ6iV5F/AhS3tF/LoOSH+W2Ez8RQ7QEd+vLf5oB+gLblUU08ULLJeXSohJFwdCxPFwCXWxm2cuxQKyMYdiAUkqoFhB1GOhlhD1aG4ZJBMMGYdzycZLF1g+DuSUDSl8SPm+YNmowwnZ6ROAyZ4Ghzr190DZ2MWOvTtzyIY3Pol9W4AE4rVM4DXGjF1vbGDb5CeZAX74AIwNvpKpFrgXMOt9JbMxBLKjqT/7eHg6T8UjKFhVmX4sIf32xr4wf4uP2/sgPebE7OYU7By+Sa5vkV3wtr64B0wHLfGeSsJrip0nli63Sb7AcVKFWEdwTZ4L1HrXRQk9T1XcDeOvYVKmPAhllEhEqtVz0jABtiIj3PIavrwvuOZo2zz+tXaQqPnVA/L0iucEcHzNFm1lCSTcRXvr2mP0703umkQjnwg+P9XgI52QHtubvQZ54eJDIpA+FhbCUPaaFxTGp+ce0jgvQTXF2WsKsTYXsPrPZ3VW6BoXsnpDXv9F6JqFsmvAnbsRpz38TnbNQ+6aKZ5rPNc8EtdQxaOA9yjgPYrqJxpj+G9VeWfFkavxabdPb5/UPIhfCHxep3w9kqYXYQC1r7LTKn0U5UP2brpg6v1KCJZ9xLNzJ/iaNUq3MPJ748PLf2wcGlBuBI6bNIKMcMiDkfUs4jbDHQD7AIfDNaG95kqAQwIWroHP0s5LBFl2h+DjtLqvBe4j2K3C/d9agTOjH7yIu4NAIiRjH5JIbgiOhiePEADHjKq27mH9HtbfYk0PU5qOsuyXp8R9W4rtW2p85PYvO5wbH9ZjzMY4VZQBortspJQoda5xrP8YJk7F9w16zs0UpCZ2VB2w8s/rCenRZ3d80jLYxBzgCTTltnJPoKkn0PRJCjSldntJoKnHtejvwegM9KBtl5JNXXUDJlu66ha9YOmqW/iypauunZChodZulHlxRLA0BA4fDyAPgYNMI/IQuOIw4eQhcBBnYxICB4cf/j9D4OC+f0MIHCibTELgPrPxXR3BYCKnT1GQp01C4M5zg4UPgYOwDpMQuFAcnSUPgbMRiikI6RSEwBWNYpZl6xBTSQhcznl2QuCKj94Vk4HceT0hwY8EpviIbbdSU668yizcOVHs8Ui6oehpSuyAhjzYHjCaasB+0rqru4hxGCtrGMc2HHqzVI5cldp/M4Rp+Mghts9Okhhub/pKGsbJTL0NZQ0hMsuv7W3R0/DwP2EhvOqMWXE8Ki4z6c6lP39fOW1w63JYsvQdGMUNItCVFjwuGGKoNccF1aT1U9Wk1Rlj1vo0WvUXNA339c5dvEnf2SeyoBUdlfcp8YG5uqyYQKtjXhVOXXTC5SFhvqqqoHbe/FmfpkWZeEXHHepdkw/O6ZxXEWyUUDJ/xSZIf1HQ63qYCCE/Cpq3405qtDKNaybTcwS2mLTuIpUf4wL7cd7Fnh8Gx3WqRUTfD5/QXNTqhzQQ+kFEOxvRt0+heJBsqasXoZx4h14TNMeazRPblg/38wlvDubYjFBoFUVhKCatWbXNWlHEkKgtDVTspQdtZuK0k5dSaZm9a/T9csOZ6MSspOjzGya/TCcTBaUNQ7bHoL6zWPv0j9U/7vT8W+oR23uEqUereTLjGAVzf2PtIHJl+5Klv1HfTFLvOCmuV6okieuVysfE9Yry7Be7IhNcZD0YE37hR2cv1uBgB7PeBmbdX4RZawPzsw3MKhuYFTYwy21gvreB+e4vx7xq453726DzZBYTxhsGfmcx/irrxlwki8UosN8i8wHErGIMMPAL9P8HqjwGH6u3spZ/7qY/qwJMf7l0CpjQVGsMNpwge9l8HpObPogus1tnHqPUIpNpJb6siDBKWZxSa3tZRYxRlMYzj0VnJByfXU9gQEBEpg5oLZCJhwLy5U4jPUpBmG9CWGzIPGiIab2Yvc45LvD6nMqUf/CHvLsCGlbpGpsYlsZKOl636FmI0j5ccbCL53OM8099ZjRdMq5wXKK1V4EoD8dQljmL9aNmUDocv5Qf8Wf6qYq/sVZ9fOj0OorMxIEgz6ObhhHKlyvEbuG4QujdjxH+cFDQsbuHMJkzKMfkAkiFUw5SLq2ihwWaI5O8IsX8KApDv47e9ypj5vJCljBk7RrBDr1RjKGM82ouSGeb+5kfvfRpjS15QCuy/ZogY5zXDQIwSsRzjyEmqvDIzcKZKr8qUgVrE1pR38doVGF0gEdeeYRwJwk4w/qRIAGulPE/CvPPdBsDZxr/XDYaK6JboUNKkLhzgLJ+FWaWQ+TteIc0B+dE46cbPffQeWgV0P+6fIIOc/2avhWyoqFnJenajXGU9IRTIRo5ldCzNuo3a0DtEUTk+GKtOZr2pfRBU7qz+z8t77VLc2m8RpGoqvHRG0jDj8bUnVoGNnSUUCIazU3kyH42+3cZ3QD6FnTvSnavhwUwPzKldyiDfBMdMUxfKcptvLAsMy67ZeyfldCdsCEZuX/NUhRt/p5Bm2BREAPP43HYE8xkEehzdWt4D1iuiCMgUAorV943ESn13J7fOO4So5V1Kn35W+gm7VsuVyZHKyqzjMoZ1+Ed9f0HrVP7yQnUFhkF8bKtz4FE3nkhW8CnlpOu1PwiRivHrGOvU1L7kETr4iYQTZeYWYFHKzDdRNMCngF5n/EYwCkZkMNGRQJdhVltNuKmosxKQYxWhdXvq1fYPUpwrG8VlXOhBb0CMVohidlxP54xWkT6905m+1I97Y7eCESLXZbRKQXQ2ErSj7mqhNQE1zUFjmMTu5a+SXG8A7nXxslfOmXfDWlOTuHQkSA0ch8U9jtOP9yYwegVtk7jFnKF8pDhH84ypuzD9RJMuasn8Qd8VSVT+YrO2+4rf7g+jrAxR5SfJAeRly+lKt++mHy/85yjSk/6+9jRVIFN6veW+OFxiH9MqSJ8eLdqiDs8FyR4+DIixmgp//Cr2QPIAXPmTfbhmRrTnB9N/eRKzMPH6/83RyL0mUDq4fuQ8+wX5MYED48H5ZYvxPn0JMhO9GnZJBgHsHdQx5jVJtgY5DsTQ65SaJhmFSE2/M4EZxlJ+K56XeLduxqii9pTcwrn7kMBeTGa2jRnPOuW7LxD1yDvnXtomQAmvZzh7JVFKTzxKgIOJeuMil3GDn+f4hayS1P6lohxjceqw5OUyXUJa8NWlF5G1X23BdAPZUV6mjD43yNU3i8Zv0+QnYMM4bsVfN7GQBJQCM3ECkqAsd6n0jF8P4CGvgMnqFMD4EHAKlr0gYKO2HjbWDeusrsBMr0nyThin0ha58ufmDKcdgUViJxU/vGXBcsOeUJjtI8AUJkATBay3ETqyXJCAEwA5kBdLBlcwhNSXAbyQ4kur7LOjWzZQrk68qUFluQExb/80CT5K1LdcMHbAiDqBrL9W8UcsD2HKSBreoAiBaTe2TmuuKg1QqJt+eWRbKRK0B8g177EuQeBK11WZ87CAzn/Xdx+7oPlyD5smxMzbYO4kQzRILSeQFvzwcEC7WREmW0yyXC47SyuDXuRLOCOTBgBbd9x4jgk+lR/Yk/9JPjj9dyK8AYkGd3MpdPHYcq7+CG606w/H7lGtoQP+uF0dAq7i1Miz0IiI60Yk5/yMhNjKP9FMaa5ao353gYG1DH7upUNEmf4DwDhwkfqPlJIFe2xdIETKZ6VY0D9UNEGJuJ/j6lmA9OY1wdwBTJE5pFj0FhMkR+YCHLeYYkjZNE2K1SZk4pgBt7LZ4m59YxigTkzMEixwrh2NbLEZKPetcaomZXEdwos2RGHv82RkxmOTjsnx4DBL8Np40b55BjIWFlcjnnKxhgr/zeOecBUsjGXG8sxoG59T44Bu9QJ+dqiQIzHvq5lAiWTY6mNta6JDQyTQ12MCbtojVFyfmO5F2h7yvIzd9N4jKaFi/TUeGo8Nf9UjbbvuOJu7pn5krfVpp1doroqNva4KTYwonOeOcxFpzUGx1szGu48T4+BqL3h8pUXVswlcgxYHNaZYJbzyi2p9LPTBDPlH8DsM8F8as1LgN01w+RIF2DsOtrgE67kl2K8wGQSPap2qGTUvm1nH5zosrHHVZyVZIXx/SjS6j5EWiYpZqb1OwfggK5PG4b5mPPqd+UMEGRv7y/vizE2+HkUWnLTxhg7bAOz628Y83NsYJCEsd0Ec9HcQE/piReL231Cnx4Na9RHNta6utaYsw5rTAfrtfdTyzX8VmezvcCVcGvvl228lf+mOGsxJqNX5h27kx536od+jIhRbi8VyhH6yUMiQGIAdv4Im5JGBn04+t6nyer6Y3zzQr4h5V9bmUKHh8xTTQuB/OWvQo6kkWnre1QK8S/R+nM2ARRF/l9U1wKsNi85DB9RrcaMpETXX64z8RsVBq++kJgedXjGi0wkyKBQxVOehPJ/HowWxA=="},"title":{"size":58,"glyphs":{" ":[0,20,1,0,54,20.1875],"!":[20,26,42,0,12,26.453125],"\"":[1112,30,42,0,12,30.21875],"#":[2372,49,42,0,12,48.59375],"$":[4430,40,53,0,10,40.359375],"%":[6550,58,44,0,11,58.109375],"&":[9102,51,44,0,11,50.578125],"'":[11346,18,42,0,12,17.75],"(":[12102,27,52,0,10,26.515625],")":[13506,27,52,0,10,26.515625],"*":[14910,30,43,0,11,30.328125],"+":[16200,49,37,0,17,48.59375],",":[18013,22,19,0,43,22.03125],"-":[18431,24,21,0,33,24.078125],".":[18935,22,11,0,43,22.03125],"/":[19177,22,48,0,12,21.1875],"0":[20233,40,44,0,11,40.359375],"1":[21993,40,42,0,12,40.359375],"2":[23673,40,43,0,11,40.359375],"3":[25393,40,44,0,11,40.359375],"4":[27153,40,42,0,12,40.359375],"5":[28833,40,43,0,12,40.359375],"6":[30553,40,44,0,11,40.359375],"7":[32313,40,42,0,12,40.359375],"8":[33993,40,44,0,11,40.359375],"9":[35753,40,44,0,11,40.359375],":":[37513,23,32,0,22,23.1875],";":[38249,23,40,0,22,23.1875],"<":[39169,49,35,0,19,48.59375],"=":[40884,49,28,0,26,48.59375],">":[42256,49,35,0,19,48.59375],"?":[43971,34,42,0,12,33.640625],"@":[45399,58,51,0,13,58.0],"A":[48357,45,42,0,12,44.890625],"B":[50247,44,42,0,12,44.203125],"C":[52095,43,44,0,11,42.5625],"D":[53987,48,42,0,12,48.140625],"E":[56003,40,42,0,12,39.625],"F":[57683,40,42,0,12,39.625],"G":[59363,48,44,0,11,47.609375],"H":[61475,49,42,0,12,48.546875],"I":[63533,22,42,0,12,21.578125],"J":[64457,26,54,-4,12,21.578125],"K":[65861,47,42,0,12,44.9375],"L":[67835,37,42,0,12,36.953125],"M":[69389,58,42,0,12,57.71875],"N":[71825,49,42,0,12,48.546875],"O":[73883,49,44,0,11,49.3125],"P":[76039,43,42,0,12,42.515625],"Q":[77845,49,51,0,11,49.3125],"R":[80344,45,42,0,12,44.65625],"S":[82234,42,44,0,11,41.765625],"T":[84082,40,42,0,12,39.5625],"U":[85762,47,43,0,12,47.09375],"V":[87783,45,42,0,12,44.890625],"W":[89673,64,42,0,12,63.96875],"X":[92361,45,42,0,12,44.71875],"Y":[94251,44,42,-1,12,42.0],"Z":[96099,42,42,0,12,42.0625],"[":[97863,27,52,0,10,26.515625],"\\":[99267,22,48,0,12,21.1875],"]":[100323,27,52,0,10,26.515625],"^":[101727,49,42,0,12,48.59375],"_":[103785,29,14,0,54,29.0],"`":[104191,29,46,0,8,29.0],"a":[105525,39,34,0,21,39.140625],"b":[106851,42,45,0,10,41.515625],"c":[108741,34,34,0,21,34.375],"d":[109897,42,45,0,10,41.515625],"e":[111787,39,34,0,21,39.34375],"f":[113113,26,44,0,10,25.234375],"g":[114257,42,46,0,21,41.515625],"h":[116189,41,44,0,10,41.296875],"i":[117993,20,44,0,10,19.875],"j":[118873,22,57,-2,10,19.875],"k":[120127,40,44,0,10,38.578125],"l":[121887,20,44,0,10,19.875],"m":[122767,60,33,0,21,60.4375],"n":[124747,41,33,0,21,41.296875],"o":[126100,40,34,0,21,39.84375],"p":[127460,42,45,0,21,41.515625],"q":[129350,42,45,0,21,41.515625],"r":[131240,29,33,0,21,28.609375],"s":[132197,35,34,0,21,34.515625],"t":[133387,28,41,0,13,27.71875],"u":[134535,41,33,0,22,41.296875],"v":[135888,38,32,0,22,37.8125],"w":[137104,54,32,0,22,53.578125],"x":[138832,37,32,0,22,37.40625],"y":[140016,38,45,0,22,37.8125],"z":[141726,34,32,0,22,33.765625],"{":[142814,41,54,0,10,41.296875],"|":[145028,21,58,0,10,21.1875],"}":[146246,41,54,0,10,41.296875],"~":[148460,49,24,0,30,48.59375]},"data":"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"},"lp":{"size":40,"glyphs":{" ":[0,14,1,0,38,13.921875],"!":[14,18,29,0,9,18.25],"\"":[536,21,29,0,9,20.84375],"#":[1145,34,29,0,9,33.515625],"$":[2131,28,36,0,8,27.828125],"%":[3139,40,30,0,8,40.078125],"&":[4339,35,30,0,8,34.890625],"'":[5389,12,29,0,9,12.25],"(":[5737,18,36,0,8,18.28125],")":[6385,18,36,0,8,18.28125],"*":[7033,21,30,0,8,20.921875],"+":[7663,34,25,0,13,33.515625],",":[8513,15,13,0,30,15.203125],"-":[8708,17,14,0,24,16.609375],".":[8946,15,8,0,30,15.203125],"/":[9066,15,33,0,9,14.609375],"0":[9561,28,30,0,8,27.828125],"1":[10401,28,29,0,9,27.828125],"2":[11213,28,30,0,8,27.828125],"3":[12053,28,30,0,8,27.828125],"4":[12893,28,29,0,9,27.828125],"5":[13705,28,29,0,9,27.828125],"6":[14517,28,30,0,8,27.828125],"7":[15357,28,29,0,9,27.828125],"8":[16169,28,30,0,8,27.828125],"9":[17009,28,30,0,8,27.828125],":":[17849,16,22,0,16,16.0],";":[18201,16,27,0,16,16.0],"<":[18633,34,24,0,14,33.515625],"=":[19449,34,19,0,19,33.515625],">":[20095,34,24,0,14,33.515625],"?":[20911,23,29,0,9,23.203125],"@":[21578,40,35,0,10,40.0],"A":[22978,31,29,0,9,30.953125],"B":[23877,30,29,0,9,30.484375],"C":[24747,29,30,0,8,29.359375],"D":[25617,33,29,0,9,33.203125],"E":[26574,27,29,0,9,27.328125],"F":[27357,27,29,0,9,27.328125],"G":[28140,33,30,0,8,32.828125],"H":[29130,33,29,0,9,33.484375],"I":[30087,15,29,0,9,14.890625],"J":[30522,18,37,-3,9,14.890625],"K":[31188,33,29,0,9,31.0],"L":[32145,25,29,0,9,25.484375],"M":[32870,40,29,0,9,39.8125],"N":[34030,33,29,0,9,33.484375],"O":[34987,34,30,0,8,34.0],"P":[36007,29,29,0,9,29.3125],"Q":[36848,34,36,0,8,34.0],"R":[38072,31,29,0,9,30.796875],"S":[38971,29,30,0,8,28.8125],"T":[39841,28,29,0,9,27.28125],"U":[40653,32,29,0,9,32.484375],"V":[41581,31,29,0,9,30.953125],"W":[42480,44,29,0,9,44.125],"X":[43756,31,29,0,9,30.84375],"Y":[44655,31,29,-1,9,28.96875],"Z":[45554,29,29,0,9,29.0],"[":[46395,18,36,0,8,18.28125],"\\":[47043,15,33,0,9,14.609375],"]":[47538,18,36,0,8,18.28125],"^":[48186,34,29,0,9,33.515625],"_":[49172,20,9,0,38,20.0],"`":[49352,20,32,0,6,20.0],"a":[49992,27,23,0,15,27.0],"b":[50613,29,30,0,8,28.640625],"c":[51483,24,23,0,15,23.71875],"d":[52035,29,30,0,8,28.640625],"e":[52905,27,23,0,15,27.125],"f":[53526,18,30,0,8,17.40625],"g":[54066,29,32,0,15,28.640625],"h":[54994,28,30,0,8,28.484375],"i":[55834,14,30,0,8,13.71875],"j":[56254,16,39,-2,8,13.71875],"k":[56878,28,30,0,8,26.609375],"l":[57718,14,30,0,8,13.71875],"m":[58138,42,23,0,15,41.6875],"n":[59104,28,23,0,15,28.484375],"o":[59748,27,23,0,15,27.484375],"p":[60369,29,31,0,15,28.640625],"q":[61268,29,31,0,15,28.640625],"r":[62167,20,23,0,15,19.734375],"s":[62627,24,23,0,15,23.8125],"t":[63179,19,28,0,10,19.125],"u":[63711,28,22,0,16,28.484375],"v":[64327,26,22,0,16,26.078125],"w":[64899,37,22,0,16,36.953125],"x":[65713,26,22,0,16,25.796875],"y":[66285,26,31,0,16,26.078125],"z":[67091,23,22,0,16,23.28125],"{":[67597,28,37,0,8,28.484375],"|":[68633,15,40,0,7,14.609375],"}":[69233,28,37,0,8,28.484375],"~":[70269,34,17,0,21,33.515625]},"data":"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"},"brand":{"size":26,"glyphs":{" ":[0,9,1,0,25,9.046875],"!":[9,12,19,0,6,11.859375],"\"":[237,14,19,0,6,13.546875],"#":[503,22,19,0,6,21.78125],"$":[921,18,24,0,5,18.09375],"%":[1353,26,19,0,6,26.046875],"&":[1847,23,19,0,6,22.671875],"'":[2284,8,19,0,6,7.953125],"(":[2436,12,23,0,5,11.890625],")":[2712,12,23,0,5,11.890625],"*":[2988,14,19,0,6,13.59375],"+":[3254,22,17,0,8,21.78125],",":[3628,10,9,0,20,9.875],"-":[3718,11,10,0,15,10.796875],".":[3828,10,5,0,20,9.875],"/":[3878,10,21,0,6,9.5],"0":[4088,18,19,0,6,18.09375],"1":[4430,18,19,0,6,18.09375],"2":[4772,18,19,0,6,18.09375],"3":[5114,18,19,0,6,18.09375],"4":[5456,18,19,0,6,18.09375],"5":[5798,18,19,0,6,18.09375],"6":[6140,18,19,0,6,18.09375],"7":[6482,18,19,0,6,18.09375],"8":[6824,18,19,0,6,18.09375],"9":[7166,18,19,0,6,18.09375],":":[7508,10,14,0,11,10.390625],";":[7648,10,18,0,11,10.390625],"<":[7828,22,16,0,9,21.78125],"=":[8180,22,13,0,12,21.78125],">":[8466,22,16,0,9,21.78125],"?":[8818,15,19,0,6,15.078125],"@":[9103,26,23,0,6,26.0],"A":[9701,20,19,0,6,20.125],"B":[10081,20,19,0,6,19.8125],"C":[10461,19,19,0,6,19.078125],"D":[10822,22,19,0,6,21.578125],"E":[11240,18,19,0,6,17.765625],"F":[11582,18,19,0,6,17.765625],"G":[11924,21,19,0,6,21.34375],"H":[12323,22,19,0,6,21.765625],"I":[12741,10,19,0,6,9.671875],"J":[12931,12,24,-2,6,9.671875],"K":[13219,21,19,0,6,20.140625],"L":[13618,17,19,0,6,16.5625],"M":[13941,26,19,0,6,25.875],"N":[14435,22,19,0,6,21.765625],"O":[14853,22,19,0,6,22.109375],"P":[15271,19,19,0,6,19.0625],"Q":[15632,22,23,0,6,22.109375],"R":[16138,20,19,0,6,20.015625],"S":[16518,19,19,0,6,18.71875],"T":[16879,18,19,0,6,17.734375],"U":[17221,21,19,0,6,21.109375],"V":[17620,20,19,0,6,20.125],"W":[18000,29,19,0,6,28.671875],"X":[18551,20,19,0,6,20.046875],"Y":[18931,21,19,-1,6,18.828125],"Z":[19330,19,19,0,6,18.859375],"[":[19691,12,23,0,5,11.890625],"\\":[19967,10,21,0,6,9.5],"]":[20177,12,23,0,5,11.890625],"^":[20453,22,19,0,6,21.78125],"_":[20871,13,6,0,25,13.0],"`":[20949,13,21,0,4,13.0],"a":[21222,18,14,0,11,17.546875],"b":[21474,19,20,0,5,18.609375],"c":[21854,15,14,0,11,15.40625],"d":[22064,19,20,0,5,18.609375],"e":[22444,18,14,0,11,17.640625],"f":[22696,12,20,0,5,11.3125],"g":[22936,19,19,0,11,18.609375],"h":[23297,19,20,0,5,18.515625],"i":[23677,9,20,0,5,8.90625],"j":[23857,10,25,-1,5,8.90625],"k":[24107,18,20,0,5,17.296875],"l":[24467,9,20,0,5,8.90625],"m":[24647,27,14,0,11,27.09375],"n":[25025,19,14,0,11,18.515625],"o":[25291,18,14,0,11,17.859375],"p":[25543,19,19,0,11,18.609375],"q":[25904,19,19,0,11,18.609375],"r":[26265,13,14,0,11,12.828125],"s":[26447,15,14,0,11,15.46875],"t":[26657,12,18,0,7,12.421875],"u":[26873,19,14,0,11,18.515625],"v":[27139,17,14,0,11,16.953125],"w":[27377,24,14,0,11,24.015625],"x":[27713,17,14,0,11,16.765625],"y":[27951,17,19,0,11,16.953125],"z":[28274,15,14,0,11,15.140625],"{":[28484,19,24,0,5,18.515625],"|":[28940,10,26,0,5,9.5],"}":[29200,19,24,0,5,18.515625],"~":[29656,22,12,0,13,21.78125]},"data":"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"}};
const WIDTH = 1600, HEIGHT = 1280;
const COLORS = { background:'#08111e', panel:'#102237', line:'#294158', text:'#edf4fc', muted:'#a8bfd4', gold:'#efca77', blue:'#8dc2ff', good:'#79dfc5' };
const fontData = new Map();
function font(key) {
  if(!FONT_MASKS[key]) throw new Error('Unknown receipt font.');
  if(!fontData.has(key)) fontData.set(key, {...FONT_MASKS[key], pixels:zlib.inflateSync(Buffer.from(FONT_MASKS[key].data,'base64'))});
  return fontData.get(key);
}
function measure(value, key) {
  const f=font(key); let width=0;
  for(const ch of String(value)) { if(!f.glyphs[ch]) throw new Error('Unsupported receipt image character.'); width+=f.glyphs[ch][5]; }
  return width;
}
function grouped(value) {
  const [whole, fraction]=String(value).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);
}
function scene(record, { testLabel=false, confirmedAt }={}) {
  R.assertRecord(record);
  const deposit=record.kind==='deposit', nodes=[];
  const rect=(x,y,w,h,color)=>nodes.push({type:'rect',x,y,w,h,color});
  const text=(value,x,y,key='body',color=COLORS.text)=>{
    value=String(value); const w=measure(value,key), height=font(key).size+12;
    if(x<0||y<0||x+w>WIDTH-48||y+height>HEIGHT) throw new Error('Receipt image text exceeds its canvas.');
    nodes.push({type:'text',value,x,y,font:key,color,w,h:height});
  };
  const amount=(value,x,y,maxWidth)=>{
    const display=grouped(value);
    for(const key of ['number','lp','asset','body','label','link']) {
      if(measure(display,key)<=maxWidth){text(display,x,y,key);return;}
    }
    // Unusual issued-token decimal values can be much longer than ordinary
    // amounts. Keep the exact digits, wrap them, and never round silently.
    let line='', lineY=y;
    for(const ch of display){if(measure(line+ch,'link')>maxWidth){text(line,x,lineY,'link');line='';lineY+=29;}line+=ch;}
    if(line)text(line,x,lineY,'link');
  };
  rect(0,0,WIDTH,HEIGHT,COLORS.background);
  rect(64,28,1472,4,COLORS.gold);
  text('XRBitcoinCash',64,54,'brand',COLORS.gold);
  text(testLabel?'EXAMPLE RECEIPT / NOT LIVE':'CONFIRMED / XRPL MAINNET',1120,58,'label',testLabel?'#ff9aaa':COLORS.good);
  text(deposit?'Liquidity added':'Liquidity removed',64,116,'title');
  text(deposit?'Your wallet supplied these assets to the pool.':'Your wallet received these assets from the pool.',64,200,'body',COLORS.muted);
  for(const [asset,x] of [[record.assetA,64],[record.assetB,820]]){
    rect(x,266,716,230,COLORS.panel);
    rect(x,266,716,3,COLORS.blue);
    text(asset.symbol,x+28,286,'asset',COLORS.blue);
    text(deposit?'SENT TO POOL':'RECEIVED FROM POOL',x+28,339,'label',COLORS.muted);
    amount(asset.value,x+28,378,660);
  }
  rect(64,524,1472,132,COLORS.panel);
  text(deposit?'LP TOKENS RECEIVED':'LP TOKENS REDEEMED',92,544,'label',COLORS.muted);
  amount(record.lp.value,92,584,1416);
  text('Asset amounts exclude the XRP network fee shown below.',64,675,'label',COLORS.muted);
  rect(64,722,1472,1,COLORS.line);
  text('TRANSACTION WALLET',64,742,'label',COLORS.gold);
  text(record.account,64,775,'detail');
  text('VALIDATED LEDGER',64,830,'label',COLORS.muted);
  text(record.ledger,64,861,'brand');
  text('TRANSACTION NETWORK FEE',570,830,'label',COLORS.muted);
  text(record.feeXrp+' XRP',570,861,'brand');
  if(confirmedAt!==undefined&&confirmedAt!==null){
    // A date may only be supplied by the caller from the verified source
    // ledger response. It is not substituted with image-generation time.
    if(typeof confirmedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(confirmedAt)||!Number.isFinite(Date.parse(confirmedAt)))throw new Error('Invalid confirmed ledger time.');
    text('CONFIRMED AT / UTC',1094,830,'label',COLORS.muted);
    text(new Date(confirmedAt).toISOString().slice(0,19).replace('T',' '),1094,867,'link');
  }
  text('AMM POOL ACCOUNT',64,914,'label',COLORS.muted);
  text(record.lp.issuer,64,948,'detail');
  text('LIQUIDITY TRANSACTION HASH',64,1001,'label',COLORS.gold);
  text(record.transactionHash,64,1035,'detail');
  rect(64,1086,1472,1,COLORS.line);
  text('MANAGE OR REDEEM YOUR LP TOKENS',64,1108,'label',COLORS.blue);
  text('https://xrbitcoincash.com/xrbc-liquidity-pool.html?pair='+record.pair+'#withdrawForm',64,1143,'link',COLORS.blue);
  text('Historical transaction receipt. Current LP tokens determine withdrawal rights.',64,1200,'label',COLORS.muted);
  return nodes;
}
const crcTable=Array.from({length:256},(_,v)=>{for(let j=0;j<8;j++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crc(buf){let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),n=Buffer.alloc(4),tail=Buffer.alloc(4);n.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([n,name,data,tail]);}
const rgb=color=>color.slice(1).match(/../g).map(v=>parseInt(v,16));
function receiptPng(record,options={}){
  const nodes=scene(record,options),pixels=Buffer.alloc(WIDTH*HEIGHT*3);
  for(const n of nodes){
    const color=rgb(n.color);
    if(n.type==='rect'){
      for(let y=n.y;y<n.y+n.h;y++)for(let x=n.x;x<n.x+n.w;x++){const offset=(y*WIDTH+x)*3;pixels[offset]=color[0];pixels[offset+1]=color[1];pixels[offset+2]=color[2];}
    }else{
      const f=font(n.font);let cursor=n.x;
      for(const ch of n.value){
        const [offset,w,h,left,top,advance]=f.glyphs[ch];
        const baseX=Math.round(cursor+left),baseY=n.y+top;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const alpha=f.pixels[offset+y*w+x];if(alpha===0)continue;
          const px=baseX+x,py=baseY+y;if(px<0||py<0||px>=WIDTH||py>=HEIGHT)throw new Error('Receipt glyph exceeds image bounds.');
          const target=(py*WIDTH+px)*3;
          for(let c=0;c<3;c++)pixels[target+c]=Math.round((color[c]*alpha+pixels[target+c]*(255-alpha))/255);
        }
        cursor+=advance;
      }
    }
  }
  const raw=Buffer.alloc((WIDTH*3+1)*HEIGHT);
  for(let y=0;y<HEIGHT;y++)pixels.copy(raw,y*(WIDTH*3+1)+1,y*WIDTH*3,(y+1)*WIDTH*3);
  const header=Buffer.alloc(13);header.writeUInt32BE(WIDTH);header.writeUInt32BE(HEIGHT,4);header[8]=8;header[9]=2;
  // Standard PNG text keeps exact receipt data accessible to image tools.
  const description=nodes.filter(n=>n.type==='text').map(n=>n.value).join('\n');
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Description\0'+description,'latin1')),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
module.exports=receiptPng;
module.exports.scene=scene;
module.exports.dimensions=Object.freeze({width:WIDTH,height:HEIGHT});

  };
  modules["./liquidity-receipts.cjs"] = function (module, exports, require, globalThis) {
'use strict';
const crypto=require('node:crypto');
const R=require('./liquidity-receipt-core.cjs');
const C=require('./liquidity-core.cjs');
const png=require('./receipt-png.cjs');
const DEFAULT_BASE='https://xrbitcoincash-github-io.onrender.com';
function digest(record){return crypto.createHash('sha256').update(C.stable(record)).digest('hex');}
function createService({rpc,publicBase=DEFAULT_BASE,now=Date.now,maxEntries=128}){
 if(typeof rpc!=='function')throw new Error('Existing read-only XRPL RPC function is required.');
 const base=new URL(publicBase);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('Invalid public receipt base URL.');
 const cache=new Map(),pending=new Map();let networkUntil=0,networkCheck=null,active=0;
 async function mainnet(){
  if(now()<networkUntil)return;
  if(!networkCheck)networkCheck=(async()=>{const raw=await rpc({method:'server_info',params:[{}]}),i=(raw.result||raw).info;
   if(i?.network_id!==0)throw new Error('Receipt source is not confirmed Mainnet.');networkUntil=now()+60000;
  })().finally(()=>networkCheck=null);
  return networkCheck;
 }
 async function get(hash){
  if(!/^[A-Fa-f0-9]{64}$/.test(hash||''))throw Object.assign(new Error('Invalid transaction hash.'),{status:400});hash=hash.toUpperCase();
  if(cache.has(hash)){const v=cache.get(hash);cache.delete(hash);cache.set(hash,v);return v;}
  if(pending.has(hash))return pending.get(hash);
  if(active>=4)throw Object.assign(new Error('Receipt service is busy. Retry shortly.'),{status:503});
  active++;
  const task=(async()=>{await mainnet();const raw=await rpc({method:'tx',params:[{transaction:hash,binary:false,api_version:2}]}),result=raw.result||raw;
   if(result.error)throw Object.assign(new Error('Validated transaction is unavailable.'),{status:404});
   let receipt;try{receipt=R.fromLedger(result,hash);}catch(e){e.status=422;throw e;}
   const d=digest(receipt),value={receipt,digest:d,metadata:R.metadata(publicBase,receipt,d),image:png(receipt,{confirmedAt:result.close_time_iso})};
   cache.set(hash,value);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);return value;
  })().finally(()=>{active--;pending.delete(hash);});
  pending.set(hash,task);return task;
 }
 return {get};
}
function install(app,{rpc,publicBase=DEFAULT_BASE,now=Date.now}={}){
 const service=createService({rpc,publicBase,now}),buckets=new Map();
 const route=async(req,res)=>{
  res.set({'Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
  const ip=String(req.ip||req.socket?.remoteAddress||'unknown'),t=now();
  let b=buckets.get(ip);if(!b||t>=b.until){b={count:0,until:t+60000};buckets.delete(ip);buckets.set(ip,b);}
  while(buckets.size>2048)buckets.delete(buckets.keys().next().value);
  if(++b.count>90){res.set('Retry-After','60');return res.status(429).json({error:'Receipt request limit reached.'});}
  const hash=req.params.hash,format=req.params.format,d=req.query.d;
  // Read-only deployment check. It does not claim a wallet or ledger test passed.
  if(hash==='status'&&format==='json'&&Object.keys(req.query).length===0){
   res.set('Cache-Control','no-store');
   return res.json({service:'xrbc-lp-receipts',release:'0.1.11',schema:R.SCHEMA,publicBase,ready:true});
  }
  if(!/^[A-Fa-f0-9]{64}$/.test(hash||'')||!['json','png'].includes(format)||!/^[a-f0-9]{64}$/.test(d||'')||Object.keys(req.query).some(k=>k!=='d'))return res.status(400).json({error:'A transaction hash and receipt digest are required.'});
  try{
   const v=await service.get(hash);if(d!==v.digest)return res.status(409).json({error:'Receipt digest does not match validated ledger facts.'});
   const etag=format==='png'?crypto.createHash('sha256').update(v.image).digest('hex'):d+'-json';
   res.set({'Cache-Control':format==='png'?'public, max-age=3600':'public, max-age=86400','ETag':'"'+etag+'"'});
   return format==='json'?res.type('application/json').send(JSON.stringify(v.metadata)):res.type('image/png').send(v.image);
  }catch(e){res.set('Cache-Control','no-store');return res.status(e.status||503).json({error:e.status?e.message:'Receipt ledger service is temporarily unavailable.'});}
 };
 app.get('/api/lp-receipts/:hash.:format',route);
 return service;
}
module.exports={install,createService,digest};

  };
  function bundledRequire(name) {
    if (name === "node:crypto" || name === "node:zlib") return require(name);
    if (!Object.prototype.hasOwnProperty.call(modules, name)) {
      throw new Error("Unknown bundled receipt module: " + name);
    }
    if (cache[name]) return cache[name].exports;
    const module = { exports: {} };
    cache[name] = module;
    modules[name](module, module.exports, bundledRequire, privateGlobals);
    return module.exports;
  }
  try {
    bundledRequire("./liquidity-receipts.cjs").install(app, {
      rpc: xrplRpc,
      publicBase: process.env.XRBC_RECEIPT_PUBLIC_BASE || "https://xrbitcoincash-github-io.onrender.com"
    });
  } catch (error) {
    console.error("[LP RECEIPTS] Optional receipt service unavailable:", error.message);
    // Report a receipt-specific problem while keeping the established routes alive.
    app.get("/api/lp-receipts/:hash.:format", (_req, res) => {
      res.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
      res.status(503).json({ service: "xrbc-lp-receipts", release: "0.1.11", ready: false,
        error: "Receipt service initialization failed. Check the backend deployment log." });
    });
  }
})();
// ===== END XRBC OPTIONAL LP RECEIPTS 0.1.11 =====

// ===== 404 fallback =====

app.use((req, res) => {
  res
    .status(404)
    .json({
      error:
        "Not found",

      path:
        req.path,

      method:
        req.method
    });
});

// ===== Boot log =====

function printRoutes() {
  const routes = [];

  const stack =
    app._router?.stack ||
    [];

  stack.forEach(
    (middleware) => {
      if (
        middleware.route
      ) {
        routes.push(
          `${Object.keys(
            middleware.route
              .methods
          )
            .join(",")
            .toUpperCase()} ${
            middleware.route
              .path
          }`
        );
      } else if (
        middleware.name ===
          "router" &&
        middleware.handle
          ?.stack
      ) {
        middleware.handle.stack.forEach(
          (
            routeLayer
          ) => {
            if (
              routeLayer.route
            ) {
              routes.push(
                `${Object.keys(
                  routeLayer
                    .route
                    .methods
                )
                  .join(",")
                  .toUpperCase()} ${
                  routeLayer
                    .route
                    .path
                }`
              );
            }
          }
        );
      }
    }
  );

  console.log(
    "[ROUTES]",
    routes
  );
}

// ===== Start =====

app.listen(
  PORT,
  () => {
    console.log(
      `✅ XRBC Secure XRPL/Chat/Support proxy running on port ${PORT}`
    );

    console.log(
      `[SUPPORT EMAIL] provider=resend configured=${supportEmailConfigured()} sender=${
        SUPPORT_EMAIL_FROM ||
        "not configured"
      } recipient=${
        SUPPORT_EMAIL_TO ||
        "not configured"
      }`
    );

    printRoutes();
  }
);
