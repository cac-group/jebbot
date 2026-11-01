import 'dotenv/config';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { memeTemplates } from './templates.js';

// NOTE: telegraf's sendPhoto is NOT used for uploads. On Node >= 24, telegraf's
// MultipartStream (a sandwich-stream Readable) deadlocks under every HTTP client
// (node-fetch@2, native fetch, pipeline), so sendPhoto hangs forever and the bot
// never replies. uploadPhoto() below builds a plain multipart Buffer and posts it
// with native fetch, which works reliably.
import { Telegraf } from 'telegraf';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN not set in .env');

const bot = new Telegraf(token);
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const UPSCALE_FACTOR = 2;

// Build a multipart/form-data body and POST it to Telegram's sendPhoto using native
// fetch. Bypasses telegraf's MultipartStream, which deadlocks on Node >= 24 (see top).
async function uploadPhoto(chatId, photoBuffer, caption = "") {
    const boundary = `----jebbot${Math.random().toString(16).slice(2)}`;
    const field = (name, filename, contentType) => {
        let head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
        if (filename) head += `; filename="${filename}"`;
        head += `\r\n`;
        if (contentType) head += `Content-Type: ${contentType}\r\n`;
        return head + `\r\n`;
    };
    const body = Buffer.concat([
        Buffer.from(field('chat_id')),
        Buffer.from(String(chatId)),
        Buffer.from('\r\n'),
        Buffer.from(field('photo', 'meme.jpg', 'image/jpeg')),
        photoBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`sendPhoto failed: ${json.description}`);
    return json.result;
}

// ------------------------
// WORD WRAPPING
// ------------------------
function wrapToMaxLines(text, maxLines, maxCharsPerLine) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = [];

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const test = [...current, w].join(" ");

        if (test.length <= maxCharsPerLine) {
            current.push(w);
        } else {
            if (current.length > 0) lines.push(current.join(" "));
            current = [w];

            if (lines.length >= maxLines - 1) {
                current = current.concat(words.slice(i + 1));
                break;
            }
        }
    }

    if (current.length > 0) lines.push(current.join(" "));
    return lines.slice(0, maxLines);
}

// ------------------------
// TRADE OFFER
// ------------------------
// Largest font size whose wrapped lines fit the given box (Impact ~0.6 char width).
function fitText(text, boxWidth, boxHeight) {
    for (let size = Math.floor(boxHeight); size >= 12; size--) {
        const maxChars = Math.max(4, Math.floor(boxWidth / (size * 0.6)));
        const lines = wrapToMaxLines(text, 99, maxChars);
        const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
        if (lines.length * size * 1.2 <= boxHeight && longest * size * 0.6 <= boxWidth) {
            return { size, lines };
        }
    }
    return { size: 12, lines: wrapToMaxLines(text, 99, Math.max(4, Math.floor(boxWidth / 7.2))) };
}

function escapeXml(s) {
    return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
}

// Boxes under the template's "i receive:" / "you receive:" labels (fractions of the image).
const TRADE_OFFER_BOX = { left: 0.19, right: 0.76, width: 0.34, top: 0.53, bottom: 0.80 };

// "/tradeoffer <left> ; <right>" — also accepts "|", else splits the words in half.
function splitTradeOffer(text) {
    for (const sep of [';', '|']) {
        const i = text.indexOf(sep);
        if (i !== -1) return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
    const words = text.split(/\s+/).filter(Boolean);
    const half = Math.ceil(words.length / 2);
    return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
}

async function renderTradeOffer(leftText, rightText) {
    const templatePath = memeTemplates.tradeoffer;
    const meta = await sharp(templatePath).metadata();
    const width = Math.round(meta.width * UPSCALE_FACTOR);
    const height = Math.round(meta.height * UPSCALE_FACTOR);

    const base = await sharp(templatePath)
        .ensureAlpha()
        .resize({ width, height })
        .toBuffer();

    const boxWidth = width * TRADE_OFFER_BOX.width;
    const boxHeight = height * (TRADE_OFFER_BOX.bottom - TRADE_OFFER_BOX.top);
    const boxTop = height * TRADE_OFFER_BOX.top;

    const parts = [];
    for (const [cx, text] of [[TRADE_OFFER_BOX.left, leftText], [TRADE_OFFER_BOX.right, rightText]]) {
        if (!text) continue;
        const { size, lines } = fitText(text, boxWidth, boxHeight);
        let y = boxTop + size + (boxHeight - lines.length * size * 1.2) / 2;
        for (const line of lines) {
            parts.push(
                `<text x="${width * cx}" y="${y}" text-anchor="middle" font-family="Anton, Impact, Arial Black, sans-serif" font-size="${size}" fill="white" stroke="black" stroke-width="${Math.ceil(size / 14)}" stroke-linejoin="round" paint-order="stroke">${escapeXml(line)}</text>`
            );
            y += size * 1.2;
        }
    }

    const svg = Buffer.from(`<svg width="${width}" height="${height}">${parts.join("")}</svg>`);

    return sharp(base)
        .composite([{ input: svg }])
        .jpeg()
        .toBuffer();
}

// ------------------------
// CLASSIC TOP/BOTTOM MEME
// ------------------------
async function renderMeme(templatePath, rawText) {
        // metadata so we can upscale
        const metadata = await sharp(templatePath).metadata();
        const upscaledWidth = Math.round(metadata.width * UPSCALE_FACTOR);
        const upscaledHeight = Math.round(metadata.height * UPSCALE_FACTOR);

        const base = await sharp(templatePath)
            .ensureAlpha()
            .resize({ width: upscaledWidth, height: upscaledHeight })
            .toBuffer();

        // -------------------------------
        // TOP ; BOTTOM handling
        // -------------------------------
        let topText = "";
        let bottomText = rawText;

        const splitIdx = rawText.indexOf(";");
        if (splitIdx !== -1) {
            topText = rawText.slice(0, splitIdx).trim();
            bottomText = rawText.slice(splitIdx + 1).trim();
        }

        const maxLines = 2;
        const maxChars = 25;

        const topLines = topText ? wrapToMaxLines(topText, maxLines, maxChars) : [];
        const bottomLines = bottomText ? wrapToMaxLines(bottomText, maxLines, maxChars) : [];

        const allLines = [...topLines, ...bottomLines];
        const totalLines = allLines.length || 1;

	// -------------------------------
	// FONT SIZE: based on HEIGHT and WIDTH
	// -------------------------------

	// Aspect ratio-based limit
	const aspect = upscaledWidth / upscaledHeight;

	// Tall images: allow more vertical text space
	// Wide images: allow less
	let maxTextAreaRatio;
	if (aspect < 1.0)       maxTextAreaRatio = 0.30; // vertical/tall
	else if (aspect < 1.4) maxTextAreaRatio = 0.25; // near-square
	else                   maxTextAreaRatio = 0.18; // wide landscape (e.g., Jeb)

	// Maximum vertical space available
	const maxTextHeight = upscaledHeight * maxTextAreaRatio;

	// Height-based size limit (divide vertical space across all lines)
	const fontSizeByHeight = maxTextHeight / totalLines;

	// Width-based size limit
	const longestLineChars = allLines.reduce(
	    (max, line) => Math.max(max, line.length),
	    1
	);

	// Leave 5% padding on each side
	const usableWidth = upscaledWidth * 0.90;

	// Impact-style font average width:height ratio
	const charAspect = 0.60;

	// Maximum width-based size
	const fontSizeByWidth = usableWidth / (longestLineChars * charAspect);

	// Final chosen font size = whichever is *smaller*
	const fontSize = Math.floor(Math.min(fontSizeByHeight, fontSizeByWidth));

	// Line spacing is proportional
	const lineSpacing = fontSize * 1.25;

        // -------------------------------
        // BUILD SVG TEXT BLOCKS
        // -------------------------------
        const svgParts = [];

        // --- TOP TEXT ---
        if (topLines.length > 0) {
            let y = fontSize + 20;
            for (let i = 0; i < topLines.length; i++) {
                svgParts.push(
                    `<text x="50%" y="${y}" text-anchor="middle" class="meme">${topLines[i]}</text>`
                );
                y += lineSpacing;
            }
        }

        // --- BOTTOM TEXT ---
        if (bottomLines.length > 0) {
            const bottomMargin = fontSize * 0.8;
            let y = upscaledHeight - bottomMargin - (bottomLines.length - 1) * lineSpacing;

            for (let i = 0; i < bottomLines.length; i++) {
                svgParts.push(
                    `<text x="50%" y="${y}" text-anchor="middle" class="meme">${bottomLines[i]}</text>`
                );
                y += lineSpacing;
            }
        }

        // -------------------------------
        // FINAL SVG
        // -------------------------------
        const svg = Buffer.from(`
<svg width="${upscaledWidth}" height="${upscaledHeight}">
<style>
.meme {
    font-family: Anton, Impact, Arial Black, sans-serif;
    font-size: ${fontSize}px;

    fill: white;

    /* classic meme outline: black stroke behind the white fill */
    stroke: black;
    stroke-width: ${Math.ceil(fontSize / 14)};
    stroke-linejoin: round;
    paint-order: stroke;

    text-transform: uppercase;
}
</style>
${svgParts.join("")}
</svg>
        `);

        return sharp(base)
            .composite([{ input: svg }])
            .jpeg()
            .toBuffer();
}

// /meme <template> <text or TOP ; BOTTOM>
bot.command('meme', async (ctx) => {
    const parts = ctx.message.text.split(' ').slice(1);
    if (parts.length < 2) {
        ctx.reply('Usage: /meme <template> <text or TOP ; BOTTOM>');
        return;
    }

    const key = parts[0].toLowerCase();
    if (!memeTemplates[key]) {
        ctx.reply(`Unknown template "${key}". Available: ${Object.keys(memeTemplates).join(", ")}`);
        return;
    }

    await sendMeme(ctx, key, parts.slice(1).join(' '));
});

// Direct per-template commands: /bellcurve <text>, /jeb <text>, /intheroom <text>
const DIRECT_COMMANDS = { bellcurve: 'bellcurve', jeb: 'jeb', intheroom: 'in-the-room' };

async function sendMeme(ctx, templateKey, rawText) {
    const text = rawText.trim();
    if (!text) {
        ctx.reply('Usage: <text or TOP ; BOTTOM> — e.g. /bellcurve hello ; world');
        return;
    }

    try {
        const image = await renderMeme(memeTemplates[templateKey], text.toUpperCase());
        await uploadPhoto(ctx.chat.id, image);
    } catch (err) {
        console.error("meme error:", err?.message, err?.stack);
        try { await ctx.reply("Error generating meme."); } catch (_) {}
    }
}

for (const [command, templateKey] of Object.entries(DIRECT_COMMANDS)) {
    bot.command(command, async (ctx) => {
        await sendMeme(ctx, templateKey, ctx.message.text.split(' ').slice(1).join(' '));
    });
}

bot.catch((err, ctx) => {
    console.error("handler error:", err?.message, err?.stack);
});

// ------------------------
// /tradeoffer COMMAND
// ------------------------
bot.command('tradeoffer', async (ctx) => {
    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const [left, right] = splitTradeOffer(raw);

    if (!left || !right) {
        ctx.reply('Usage: /tradeoffer <what you receive> ; <what they receive>');
        return;
    }

    try {
        const image = await renderTradeOffer(left.toUpperCase(), right.toUpperCase());
        await uploadPhoto(ctx.chat.id, image);
    } catch (err) {
        console.error("tradeoffer error:", err?.message, err?.stack);
        try { await ctx.reply("Error generating meme."); } catch (_) {}
    }
});

// ------------------------
// /memes LIST
// ------------------------
bot.command('memes', (ctx) => {
    ctx.reply(`Available templates: ${Object.keys(memeTemplates).join(", ")}`);
});

// ------------------------
// UNKNOWN /command FALLBACK
// ------------------------
const HELP_TEXT = [
    'Commands:',
    '/meme <template> <text or TOP ; BOTTOM>',
    '/bellcurve <text or TOP ; BOTTOM>',
    '/jeb <text or TOP ; BOTTOM>',
    '/intheroom <text or TOP ; BOTTOM>',
    '/tradeoffer <you receive> ; <they receive>',
    '/memes — list available templates',
].join('\n');

bot.on('text', (ctx) => {
    if (!ctx.message.text.trim().startsWith('/')) return;
    return ctx.reply(HELP_TEXT);
});

bot.launch()
    .catch((err) => {
        console.error("Bot failed to launch:", err.message);
        process.exit(1);
    });
console.log("Bot is running...");
