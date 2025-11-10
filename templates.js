import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');

export const memeTemplates = {};

// Automatically load all .webp, .png, .jpg files from data directory
fs.readdirSync(dataDir).forEach((file) => {
    if (/\.(webp|png|jpg|jpeg)$/i.test(file)) {
        const name = path.parse(file).name.toLowerCase(); // use file name as template key
        memeTemplates[name] = path.join(dataDir, file);
    }
});
