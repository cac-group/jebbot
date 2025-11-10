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

// Upscale factor for output images
const UPSCALE_FACTOR = 2;

// Split text into lines of max N characters for multi-line display
function wrapText(text, maxCharsPerLine = 20) {
    return text.match(new RegExp(`.{1,${maxCharsPerLine}}(\\s|$)`, 'g')).map(l => l.trim());
}

// Compute font size based on vertical space and number of lines
function getFontSizeForTextByHeight(lines, imageHeight, maxTextAreaRatio = 0.3) {
    const maxTextHeight = imageHeight * maxTextAreaRatio;
    return Math.floor(maxTextHeight / lines.length);
}

// Meme command
bot.command('meme', async (ctx) => {
    const textParts = ctx.message.text.split(' ').slice(1);
    if (textParts.length < 2) {
        ctx.reply('Usage: /meme <template_name> <text>');
        return;
    }

    const templateName = textParts[0].toLowerCase();
    const overlayText = textParts.slice(1).join(' ').trim().toUpperCase();
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    if (!memeTemplates[templateName]) {
        ctx.reply(`Unknown template "${templateName}". Available templates: ${Object.keys(memeTemplates).join(", ")}`);
        return;
    }

    const templatePath = memeTemplates[templateName];
    const timestamp = Date.now();
    const outputImagePath = path.join(dataDir, `output_${chatId}_${userId}_${timestamp}.webp`);

    try {
        // Get original metadata
        const metadata = await sharp(templatePath).metadata();
        const upscaledWidth = Math.round(metadata.width * UPSCALE_FACTOR);
        const upscaledHeight = Math.round(metadata.height * UPSCALE_FACTOR);

        // Resize
        const templateImageBuffer = await sharp(templatePath)
            .ensureAlpha()
            .resize({ width: upscaledWidth, height: upscaledHeight })
            .toBuffer();

        // Wrap text into multiple lines
        const lines = wrapText(overlayText, 20); // 20 chars max per line
        const fontSize = getFontSizeForTextByHeight(lines, upscaledHeight);
        const lineSpacing = fontSize * 1.2;

        // Generate text overlay
        const svgLines = lines.map((line, idx) => {
            const yPos = upscaledHeight - 20 - (lines.length - idx - 1) * lineSpacing;
            return `<text x="50%" y="${yPos}" text-anchor="middle" class="meme">${line}</text>`;
        }).join('');

        const textSvg = Buffer.from(`
<svg width="${upscaledWidth}" height="${upscaledHeight}">
    <style>
        .meme {
            font-family: Impact, Arial, sans-serif;
            font-size: ${fontSize}px;
            fill: white;
            stroke: black;
            stroke-width: ${Math.ceil(fontSize / 15)};
            text-transform: uppercase;
        }
    </style>
    ${svgLines}
</svg>
        `);

        // Composite SVG over template
        const finalImage = await sharp(templateImageBuffer)
            .composite([{ input: textSvg }])
            .toFormat('webp')
            .toBuffer();

        // Send inline photo
        await ctx.replyWithPhoto({ source: finalImage });

    } catch (err) {
        console.error(err);
        ctx.reply('Error generating meme.');
    }
});

// List templates
bot.command('memes', (ctx) => {
    ctx.reply(`Available templates: ${Object.keys(memeTemplates).join(", ")}`);
});

bot.launch();
console.log('Bot is running...');
