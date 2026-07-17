import 'dotenv/config';
import { Telegraf } from 'telegraf';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { memeTemplates } from './templates.js';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN not set in .env');

const bot = new Telegraf(token);
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const UPSCALE_FACTOR = 2;

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
// /meme COMMAND
// ------------------------
bot.command('meme', async (ctx) => {
    const textParts = ctx.message.text.split(' ').slice(1);
    if (textParts.length < 2) {
        ctx.reply('Usage: /meme <template> <text or TOP ; BOTTOM>');
        return;
    }

    const templateName = textParts[0].toLowerCase();
    const rawText = textParts.slice(1).join(' ').trim().toUpperCase();

    if (!memeTemplates[templateName]) {
        ctx.reply(`Unknown template "${templateName}". Available: ${Object.keys(memeTemplates).join(", ")}`);
        return;
    }

    const templatePath = memeTemplates[templateName];

    try {
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
    font-family: Impact, Arial Black, sans-serif;
    font-size: ${fontSize}px;

    fill: white;

    /* thicker text without outline */
    stroke: white;
    stroke-width: ${Math.ceil(fontSize / 12)};
    stroke-linejoin: round;
    paint-order: stroke;

    text-transform: uppercase;
}
</style>
${svgParts.join("")}
</svg>
        `);

        const result = await sharp(base)
            .composite([{ input: svg }])
            .webp()
            .toBuffer();

        await ctx.replyWithPhoto({ source: result });

    } catch (err) {
        console.error(err);
        ctx.reply("Error generating meme.");
    }
});

// ------------------------
// /memes LIST
// ------------------------
bot.command('memes', (ctx) => {
    ctx.reply(`Available templates: ${Object.keys(memeTemplates).join(", ")}`);
});

bot.launch();
console.log("Bot is running...");
