// === ChatGPT Auditor Proxy ===
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages array' });
    }

    const payload = {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
    };

    const r = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      timeout: 30000,
      validateStatus: () => true, // let us handle non-200s
    });

    // ensure JSON response
    if (!r.data || typeof r.data !== "object") {
      console.error("OpenAI non-JSON response:", r.status, r.data);
      return res.status(502).json({ error: "OpenAI returned non-JSON", status: r.status });
    }

    if (r.status < 200 || r.status >= 300) {
      console.error("OpenAI error:", r.status, r.data);
      return res.status(502).json({ error: "Upstream OpenAI error", status: r.status, detail: r.data });
    }

    return res.json(r.data);
  } catch (err) {
    console.error("[chat proxy error]", err.message || err);
    res.status(502).json({ error: "Chat proxy request failed", detail: err.message || String(err) });
  }
});
