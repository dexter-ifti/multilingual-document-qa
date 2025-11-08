const express = require('express');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

// Configure Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your-gemini-api-key-here';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// In-memory storage (use database in production)
const documentsStore = new Map();
const documentTexts = new Map();

// Helper function to extract text from PDF with page numbers
async function extractPagesFromPDF(buffer) {
    const data = await pdfParse(buffer);
    const pages = {};

    // Split by page breaks (approximate)
    const pageTexts = data.text.split('\f');

    pageTexts.forEach((text, index) => {
        if (text.trim()) {
            pages[index + 1] = text.trim();
        }
    });

    // If no page breaks found, treat entire text as one page
    if (Object.keys(pages).length === 0) {
        pages[1] = data.text;
    }

    return {
        pages,
        totalPages: data.numpages,
        info: data.info
    };
}

// Helper function to create context from documents
function createContextFromDocuments(docIds) {
    const contextParts = [];

    docIds.forEach(docId => {
        if (documentTexts.has(docId)) {
            const docInfo = documentsStore.get(docId);
            const pages = documentTexts.get(docId);

            Object.entries(pages).forEach(([pageNum, text]) => {
                contextParts.push(
                    `[Document: ${docInfo.filename}, Page: ${pageNum}]\n${text}\n`
                );
            });
        }
    });

    return contextParts.join('\n\n');
}

// Helper function to parse Gemini response
function parseGeminiResponse(responseText, docIds) {
    // Extract source citations
    const sourcePattern = /\[Document: ([^,]+), Page: (\d+)\]/g;
    const sources = [];
    const seenSources = new Set();

    let match;
    while ((match = sourcePattern.exec(responseText)) !== null) {
        const filename = match[1].trim();
        const pageNum = parseInt(match[2]);

        // Find document ID
        let docId = null;
        for (const [id, doc] of documentsStore.entries()) {
            if (docIds.includes(id) && doc.filename === filename) {
                docId = id;
                break;
            }
        }

        const sourceKey = `${filename}-${pageNum}`;
        if (!seenSources.has(sourceKey)) {
            sources.push({
                document_id: docId,
                filename: filename,
                page_number: pageNum
            });
            seenSources.add(sourceKey);
        }
    }

    // Clean answer by removing citation markers
    const cleanAnswer = responseText.replace(sourcePattern, '').trim();

    return {
        answer: cleanAnswer,
        sources: sources,
        confidence: 0.85
    };
}

// Routes

// Health check
app.get('/', (req, res) => {
    res.json({
        message: 'Multilingual Document QA API',
        status: 'running',
        version: '1.0.0'
    });
});

// Upload document
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ detail: 'No file uploaded' });
        }

        const filename = req.file.originalname;
        const buffer = req.file.buffer;

        // Extract text from PDF
        const pdfData = await extractPagesFromPDF(buffer);

        if (pdfData.totalPages > 100) {
            return res.status(400).json({
                detail: 'Document must have less than 100 pages'
            });
        }

        // Generate document ID
        const docId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store document info
        documentsStore.set(docId, {
            id: docId,
            filename: filename,
            upload_time: new Date().toISOString(),
            pages: pdfData.totalPages,
            size_mb: (buffer.length / (1024 * 1024)).toFixed(2)
        });

        // Store extracted text
        documentTexts.set(docId, pdfData.pages);

        res.json({
            document_id: docId,
            filename: filename,
            pages: pdfData.totalPages,
            message: 'Document uploaded successfully'
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            detail: `Error processing PDF: ${error.message}`
        });
    }
});

// List documents
app.get('/documents', (req, res) => {
    const documents = Array.from(documentsStore.values());
    res.json({ documents });
});

// Delete document
app.delete('/documents/:documentId', (req, res) => {
    const { documentId } = req.params;

    if (!documentsStore.has(documentId)) {
        return res.status(404).json({ detail: 'Document not found' });
    }

    documentsStore.delete(documentId);
    documentTexts.delete(documentId);

    res.json({ message: 'Document deleted successfully' });
});

// Ask question
app.post('/ask', async (req, res) => {
    try {
        const { question, document_ids } = req.body;

        if (!question) {
            return res.status(400).json({ detail: 'Question is required' });
        }

        // Determine which documents to search
        const docIds = document_ids || Array.from(documentsStore.keys());

        if (docIds.length === 0) {
            return res.status(400).json({ detail: 'No documents available' });
        }

        // Validate document IDs
        for (const docId of docIds) {
            if (!documentsStore.has(docId)) {
                return res.status(404).json({
                    detail: `Document ${docId} not found`
                });
            }
        }

        // Create context from documents
        const context = createContextFromDocuments(docIds);

        if (!context) {
            return res.status(400).json({
                detail: 'No content found in selected documents'
            });
        }

        // Create prompt for Gemini
        const prompt = `You are a helpful assistant that answers questions based on the provided documents.
The documents may be in various Indian languages (Hindi, Tamil, Telugu, Bengali, etc.) or English.

Context from documents:
${context}

Question: ${question}

Instructions:
1. Answer the question based ONLY on the information in the provided documents
2. If the answer spans multiple pages or documents, mention all relevant sources
3. When citing sources, use the format: [Document: filename, Page: X]
4. If you cannot find the answer in the documents, say so clearly
5. Provide the answer in clear, fluent English regardless of the source language

Answer:`;

        // Use Gemini to generate answer
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Parse response
        const answer = parseGeminiResponse(text, docIds);

        res.json(answer);

    } catch (error) {
        console.error('Ask error:', error);
        res.status(500).json({
            detail: `Error generating answer: ${error.message}`
        });
    }
});

// Get page text
app.get('/documents/:documentId/page/:pageNumber', (req, res) => {
    const { documentId, pageNumber } = req.params;
    const pageNum = parseInt(pageNumber);

    if (!documentsStore.has(documentId)) {
        return res.status(404).json({ detail: 'Document not found' });
    }

    const pages = documentTexts.get(documentId);

    if (!pages[pageNum]) {
        return res.status(404).json({ detail: 'Page not found' });
    }

    const docInfo = documentsStore.get(documentId);

    res.json({
        document_id: documentId,
        filename: docInfo.filename,
        page_number: pageNum,
        text: pages[pageNum]
    });
});

// Translate text
app.post('/translate', async (req, res) => {
    try {
        const text = req.body;
        const targetLanguage = req.query.target_language || 'en';

        if (!text || typeof text !== 'string') {
            return res.status(400).json({ detail: 'Text is required' });
        }

        const prompt = `Translate the following text to ${targetLanguage}. 
If the text is already in ${targetLanguage}, return it as is.

Text: ${text}

Translation:`;

        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const translated = response.text();

        res.json({
            original: text,
            translated: translated,
            target_language: targetLanguage
        });

    } catch (error) {
        console.error('Translate error:', error);
        res.status(500).json({
            detail: `Error translating text: ${error.message}`
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        detail: err.message || 'Internal server error'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📚 API documentation available at http://localhost:${PORT}/docs`);
    console.log(`🔑 Gemini API configured: ${GEMINI_API_KEY ? 'Yes' : 'No'}`);
});

module.exports = app;