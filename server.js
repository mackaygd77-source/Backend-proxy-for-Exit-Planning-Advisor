// server.js — Exit Advisor API Proxy
//
// Endpoints:
//   GET  /health                 — liveness check
//   POST /api/claude             — proxy to Anthropic Claude API  (unchanged)
//   POST /api/fetch-url          — fetch a public webpage server-side
//   POST /api/extract-document   — extract text from PDF / PPTX / DOCX
//
// New dependencies (run once in your project folder):
//   npm install cheerio multer pdf-parse unzipper xml2js
//   (node-fetch is already installed)

const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const multer   = require('multer');
const cheerio  = require('cheerio');
const pdfParse = require('pdf-parse');
const unzipper = require('unzipper');
const xml2js   = require('xml2js');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Multer: memory storage, 20 MB cap, PDF/PPTX/DOCX only
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.pptx', '.ppt', '.docx', '.doc'];
        const ext = path.extname(file.originalname).toLowerCase();
        allowed.includes(ext)
            ? cb(null, true)
            : cb(new Error('Only PDF, PPTX, and Word documents are supported'));
    }
});


// ── GET /health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', message: 'Exit Advisor API Proxy is running' });
});


// ── POST /api/claude ───────────────────────────────────────────────────────────
// Unchanged from original.
app.post('/api/claude', async (req, res) => {
    try {
        const { apiKey, messages, systemPrompt } = req.body;

        if (!apiKey)                                return res.status(400).json({ error: 'API key is required' });
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages array is required' });

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type':      'application/json',
                'x-api-key':         apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model:      'claude-sonnet-4-20250514',
                max_tokens: 2000,
                system:     systemPrompt,
                messages:   messages
            })
        });

        if (!response.ok) {
            const err = await response.json();
            return res.status(response.status).json({ error: err.error?.message || 'API request failed' });
        }

        res.json(await response.json());

    } catch (error) {
        console.error('Claude proxy error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});


// ── POST /api/fetch-url ────────────────────────────────────────────────────────
// Fetches a public webpage server-side, strips noise, returns clean text.
// Body:     { url: "https://..." }
// Response: { text, title, url, truncated }
app.post('/api/fetch-url', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    let parsed;
    try {
        parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol))
            return res.status(400).json({ error: 'Only http/https URLs are supported' });
    } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    // SSRF protection — block private ranges
    const host = parsed.hostname;
    if (/^localhost$|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^0\.0\.0\.0$|^::1$/.test(host))
        return res.status(403).json({ error: 'Private/internal URLs are not allowed' });

    try {
        // node-fetch v2: use AbortController for timeout (the 'timeout' option is not reliable)
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        let response;
        try {
            response = await fetch(parsed.toString(), {
                signal: controller.signal,
                headers: {
                    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control':   'no-cache',
                },
            });
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            console.error(`[fetch-url] ${host} returned ${response.status}`);
            return res.status(502).json({ error: `Site returned HTTP ${response.status}` });
        }

        // Accept any content — some sites return wrong content-type headers
        const ct = response.headers.get('content-type') || '';
        console.log(`[fetch-url] ${host} status=200 content-type="${ct}"`);

        const $ = cheerio.load(await response.text());

        // Remove noise elements
        $('script,style,noscript,nav,footer,header,aside,iframe').remove();
        $('[aria-hidden="true"],[role="banner"],[role="navigation"]').remove();
        $('[class*="cookie"],[class*="popup"],[class*="modal"],[id*="cookie"]').remove();
        $('[class*="menu"],[class*="sidebar"],[class*="ad-"]').remove();

        const title = $('title').text().trim() || $('h1').first().text().trim() || host;

        let text = '';
        for (const sel of ['main','article','[role="main"]','.content','#content','#main','body']) {
            const c = $(sel).first().text();
            if (c && c.trim().length > 200) { text = c; break; }
        }
        if (!text) text = $('body').text();

        text = text.replace(/\t/g,' ').replace(/ {2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();

        const truncated = text.length > 12000;
        if (truncated) text = text.slice(0, 12000) + '\n\n[Content truncated]';

        console.log(`[fetch-url] ${host} → ${text.length} chars`);
        res.json({ text, title, url: parsed.toString(), truncated });

    } catch (err) {
        if (err.name === 'AbortError')
            return res.status(504).json({ error: 'Timed out after 15s — site too slow' });
        console.error('[fetch-url]', err.message);
        res.status(502).json({ error: 'Failed to fetch URL: ' + err.message });
    }
});


// ── POST /api/extract-document ─────────────────────────────────────────────────
// Accepts PDF/PPTX/DOCX upload, returns extracted plain text.
// Field name: "document"
// Response:   { text, filename, pages, type, truncated }
app.post('/api/extract-document', upload.single('document'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'No file received. Use field name "document".' });

    const { buffer, originalname } = req.file;
    const ext = path.extname(originalname).toLowerCase();

    try {
        let text = '', pages = 0, type = '';

        if (ext === '.pdf') {
            type = 'pdf';
            const data = await pdfParse(buffer);
            text = data.text; pages = data.numpages;

        } else if (ext === '.pptx' || ext === '.ppt') {
            type = 'pptx';
            const r = await extractPptx(buffer);
            text = r.text; pages = r.slideCount;

        } else if (ext === '.docx' || ext === '.doc') {
            type = 'docx';
            text = await extractDocx(buffer); pages = 1;

        } else {
            return res.status(415).json({ error: 'Unsupported file type: ' + ext });
        }

        text = text.replace(/\t/g,' ').replace(/ {2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();

        if (!text || text.length < 20)
            return res.status(422).json({ error: 'No readable text found — file may be image-only or encrypted.' });

        const truncated = text.length > 15000;
        if (truncated) text = text.slice(0, 15000) + '\n\n[Content truncated]';

        console.log(`[extract-document] "${originalname}" → ${text.length} chars, ${pages} pages`);
        res.json({ text, filename: originalname, pages, type, truncated });

    } catch (err) {
        console.error('[extract-document]', err.message);
        res.status(500).json({ error: 'Extraction failed: ' + err.message });
    }
});


// ── Helpers ────────────────────────────────────────────────────────────────────
async function extractPptx(buffer) {
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const dir    = await unzipper.Open.buffer(buffer);
    const files  = dir.files
        .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f.path))
        .sort((a, b) => parseInt(a.path.match(/\d+/)[0],10) - parseInt(b.path.match(/\d+/)[0],10));

    const slides = [];
    for (let i = 0; i < files.length; i++) {
        let parsed;
        try { parsed = await parser.parseStringPromise((await files[i].buffer()).toString('utf8')); }
        catch { continue; }
        const t = collectText(parsed).trim();
        if (t) slides.push(`[Slide ${i+1}]\n${t}`);
    }
    return { text: slides.join('\n\n'), slideCount: files.length };
}

async function extractDocx(buffer) {
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const dir    = await unzipper.Open.buffer(buffer);
    const doc    = dir.files.find(f => f.path === 'word/document.xml');
    if (!doc) throw new Error('word/document.xml not found');
    const parsed = await parser.parseStringPromise((await doc.buffer()).toString('utf8'));
    return collectText(parsed).replace(/ +/g,' ').trim();
}

function collectText(node) {
    if (!node)                    return '';
    if (typeof node === 'string') return node + ' ';
    if (Array.isArray(node))      return node.map(collectText).join('');
    let out = '';
    for (const [k, v] of Object.entries(node)) {
        if (k === 'a:t' || k === 'w:t' || k === '_')
            out += (typeof v === 'string' ? v : collectText(v)) + ' ';
        else if (typeof v === 'object')
            out += collectText(v);
    }
    return out;
}


// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Exit Advisor API Proxy running on port ${PORT}`);
    console.log('   Endpoints: /health  /api/claude  /api/fetch-url  /api/extract-document');
});
