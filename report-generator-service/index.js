const express = require('express');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ImageModule = require('docxtemplater-image-module-free');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const libre = require('libreoffice-convert');
const util = require('util');

// Promisify the convert function
libre.convertAsync = util.promisify(libre.convert);

const app = express();
// Use PUBLIC_HOSTNAME for external links, default to localhost
const hostname = process.env.PUBLIC_HOSTNAME || 'localhost';
const port = process.env.PORT || 3000;

// Create necessary directories if they don't exist
const reportsDir = path.join(__dirname, 'generated_reports');
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
}

// Middleware to parse JSON bodies
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
        if (typeof tagValue === 'string') {
            return await getImageBuffer(tagValue);
        }
        // This handles cases where the script might pass an array of attachments
        if (Array.isArray(tagValue) && tagValue.length > 0 && tagValue[0].url) {
            return await getImageBuffer(tagValue[0].url);
        }
        return tagValue;
    },
    getSize: () => [250, 250],
};


// Main API endpoint for report generation
app.post('/api/v2/processes/fmlxrneq/hxuvqhn/start', async (req, res) => {
    const uniqueId = uuidv4();
    const outputDocxPath = path.join(reportsDir, `${uniqueId}.docx`);
    const outputPdfPath = path.join(reportsDir, `${uniqueId}.pdf`);

    try {
        console.log('Received payload for report generation.');
        const payload = req.body;

        const templatePath = path.resolve(__dirname, '..', 'template', 'template.docx');
        if (!fs.existsSync(templatePath)) {
            console.error('Template file not found at:', templatePath);
            return res.status(500).json({ message: 'Template file not found.' });
        }
        const content = fs.readFileSync(templatePath, 'binary');

        const imageModule = new ImageModule(imageOpts);
        const zip = new PizZip(content);
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

        console.log('Starting PDF conversion with LibreOffice...');
        const docxBuf = fs.readFileSync(outputDocxPath);
        const pdfBuf = await libre.convertAsync(docxBuf, '.pdf', undefined);
        fs.writeFileSync(outputPdfPath, pdfBuf);
        console.log(`Generated PDF file: ${outputPdfPath}`);

        // Use the configurable hostname for the public link
        const publicLink = `http://${hostname}:${port}/reports/${uniqueId}.pdf`;
        res.status(200).json({
            link: publicLink
        });

    } catch (error) {
        console.error('Error generating document:', error);
        if (error.properties && error.properties.errors) {
            console.error('Docxtemplater errors:', error.properties.errors);
            return res.status(500).json({
                message: 'Failed to generate document due to template errors.',
                errors: error.properties.errors.map(e => ({ id: e.properties.id, context: e.properties.context, message: e.message }))
            });
        }
        res.status(500).json({ message: 'An internal server error occurred.', error: error.message });
    } finally {
        // Clean up temporary files
        if (fs.existsSync(outputDocxPath)) {
            fs.unlinkSync(outputDocxPath);
            console.log(`Cleaned up temporary file: ${outputDocxPath}`);
        }
        if (fs.existsSync(outputPdfPath)) {
            // In a real scenario, you might delay this to ensure Airtable has time to download it.
            // For this service, we assume Airtable downloads it synchronously.
            fs.unlinkSync(outputPdfPath);
            console.log(`Cleaned up generated PDF: ${outputPdfPath}`);
        }
    }
});

// Static file server to serve generated reports
app.use('/reports', express.static(reportsDir));

app.listen(port, () => {
    console.log(`Report generator service listening at http://${hostname}:${port}`);
});
