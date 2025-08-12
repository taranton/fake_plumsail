const express = require('express');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ImageModule = require('docxtemplater-image-module-free');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');

const app = express();
const hostname = process.env.PUBLIC_HOSTNAME || 'localhost';
const port = process.env.PORT || 3000;

const reportsDir = path.join(__dirname, 'generated_reports');
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- Image Module Setup ---
const getImageBuffer = async (url) => {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data, 'binary');
    } catch (error) {
        console.error(`Error fetching image from ${url}:`, error.message);
        return null;
    }
};

const imageOpts = {
    centered: false,
    getImage: async (tagValue, tagName) => {
        if (!tagValue) return null;
        if (typeof tagValue === 'string' && tagValue.startsWith('http')) {
            return await getImageBuffer(tagValue);
        }
        if (Array.isArray(tagValue) && tagValue.length > 0 && tagValue[0].url) {
            return await getImageBuffer(tagValue[0].url);
        }
        if (typeof tagValue === 'object' && tagValue.url) {
            return await getImageBuffer(tagValue.url);
        }
        return tagValue;
    },
    getSize: () => [250, 250],
};

// --- Main API Endpoint ---
app.post('/api/v2/processes/fmlxrneq/hxuvqhn/start', async (req, res) => {
    const uniqueId = uuidv4();
    const outputDocxPath = path.join(reportsDir, `${uniqueId}.docx`);
    const outputPdfPath = path.join(reportsDir, `${uniqueId}.pdf`);

    try {
        console.log('Received payload for report generation.');
        const payload = req.body;

        const templatePath = path.resolve(__dirname, '..', 'template', 'template.docx');
        if (!fs.existsSync(templatePath)) {
            return res.status(500).json({ message: 'Template file not found.' });
        }
        const content = fs.readFileSync(templatePath);
        const zip = new PizZip(content);

        // Pre-process the template XML to remove Plumsail formatters
        const tagRegex = /\{\{([^{}]+?)\}\}/g;
        const imageTagRegex = /\{%([^{}]+?)%}/g;

        for (const [fileName, file] of Object.entries(zip.files)) {
            if (fileName.endsWith('.xml')) {
                let text = file.asText();

                text = text.replace(tagRegex, (match, tagContent) => {
                    const colonIndex = tagContent.indexOf(':');
                    if (colonIndex !== -1) {
                        const newTag = tagContent.substring(0, colonIndex).trim();
                        return `{{${newTag}}}`;
                    }
                    return match;
                });

                text = text.replace(imageTagRegex, (match, tagContent) => {
                    const colonIndex = tagContent.indexOf(':');
                     if (colonIndex !== -1) {
                        const newTag = tagContent.substring(0, colonIndex).trim();
                        return `{%${newTag}}`;
                    }
                    return match;
                });

                zip.file(fileName, text);
            }
        }

        const imageModule = new ImageModule(imageOpts);
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            modules: [imageModule],
        });

        doc.render(payload);

        const buf = doc.getZip().generate({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });

        fs.writeFileSync(outputDocxPath, buf);
        console.log(`Generated DOCX file: ${outputDocxPath}`);

        console.log('Starting PDF conversion with Puppeteer...');
        const { value: html } = await mammoth.convertToHtml({ buffer: buf });

        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({ path: outputPdfPath, format: 'A4', printBackground: true });
        await browser.close();
        console.log(`Generated PDF file: ${outputPdfPath}`);

        const publicLink = `http://${hostname}:${port}/reports/${uniqueId}.pdf`;
        res.status(200).json({ link: publicLink });

    } catch (error) {
        console.error('Error generating document:', error);
        if (error.properties && error.properties.errors) {
            return res.status(500).json({
                message: 'Failed to generate document due to template errors.',
                errors: error.properties.errors.map(e => ({ id: e.properties.id, context: e.properties.context, message: e.message }))
            });
        }
        res.status(500).json({ message: 'An internal server error occurred.', error: { message: error.message, stack: error.stack } });
    } finally {
        if (fs.existsSync(outputDocxPath)) fs.unlinkSync(outputDocxPath);
        if (fs.existsSync(outputPdfPath)) fs.unlinkSync(outputPdfPath);
        console.log('Cleaned up temporary files.');
    }
});

app.use('/reports', express.static(reportsDir));

app.listen(port, () => {
    console.log(`Report generator service listening at http://${hostname}:${port}`);
});
