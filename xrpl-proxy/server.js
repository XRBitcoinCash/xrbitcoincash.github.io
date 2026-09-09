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

// ===== BEGIN XRBC OPTIONAL LP RECEIPTS 0.1.10 =====
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
// Deterministic PNG rendering with Node built-ins; no font files or image service.
const zlib=require('node:zlib');
const R=require('./liquidity-receipt-core.cjs');
const rows={
 '0':['01110','10001','10011','10101','11001','10001','01110'], '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'], '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'], '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'], '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'], '9':['01110','10001','10001','01111','00001','00001','01110'],
 A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],
 C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],
 E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],
 G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],
 I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],
 K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],
 M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],
 O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],
 Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],
 S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],
 U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],
 W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],
 Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
 '.':['00000','00000','00000','00000','00000','00110','00110'], '/':['00001','00010','00010','00100','01000','01000','10000'],
 '-':['00000','00000','00000','11111','00000','00000','00000'], ':':['00000','00100','00100','00000','00100','00100','00000'],
 ' ':['00000','00000','00000','00000','00000','00000','00000']
};
const crcTable=Array.from({length:256},(_,v)=>{for(let j=0;j<8;j++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crc(buf){let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),n=Buffer.alloc(4),tail=Buffer.alloc(4);n.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([n,name,data,tail]);}
module.exports=function receiptPng(record,{testLabel=false}={}){
 const width=1200,height=720,pixels=Buffer.alloc(width*height*3);
 const rect=(x,y,w,h,color)=>{const rgb=color.slice(1).match(/../g).map(v=>parseInt(v,16));for(let dy=Math.max(0,y);dy<Math.min(height,y+h);dy++)for(let dx=Math.max(0,x);dx<Math.min(width,x+w);dx++){const o=(dy*width+dx)*3;for(let c=0;c<3;c++)pixels[o+c]=rgb[c];}};
 const scene=R.scene(record);if(testLabel)scene.push({type:'text',value:'EXAMPLE - NOT A LIVE TRANSACTION',x:650,y:56,scale:2,color:'#ff9aab'});
 for(const n of scene){
  if(n.type==='rect')rect(n.x,n.y,n.w,n.h,n.color);
  else for(let i=0;i<n.value.length;i++){const glyph=rows[n.value[i]]||rows[' '];for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(glyph[y][x]==='1')rect(n.x+i*6*n.scale+x*n.scale,n.y+y*n.scale,n.scale,n.scale,n.color);}
 }
 const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)pixels.copy(raw,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
};

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
   const d=digest(receipt),value={receipt,digest:d,metadata:R.metadata(publicBase,receipt,d),image:png(receipt)};
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
   return res.json({service:'xrbc-lp-receipts',release:'0.1.10',schema:R.SCHEMA,publicBase,ready:true});
  }
  if(!/^[A-Fa-f0-9]{64}$/.test(hash||'')||!['json','png'].includes(format)||!/^[a-f0-9]{64}$/.test(d||'')||Object.keys(req.query).some(k=>k!=='d'))return res.status(400).json({error:'A transaction hash and receipt digest are required.'});
  try{
   const v=await service.get(hash);if(d!==v.digest)return res.status(409).json({error:'Receipt digest does not match validated ledger facts.'});
   res.set({'Cache-Control':'public, max-age=86400','ETag':'"'+d+'-'+format+'"'});
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
      res.status(503).json({ service: "xrbc-lp-receipts", release: "0.1.10", ready: false,
        error: "Receipt service initialization failed. Check the backend deployment log." });
    });
  }
})();
// ===== END XRBC OPTIONAL LP RECEIPTS 0.1.10 =====

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
