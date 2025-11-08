import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_URL = 'http://localhost:8000';

function App() {
  const [documents, setDocuments] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedPage, setSelectedPage] = useState(null);
  const [pageText, setPageText] = useState(null);
  const [translatedText, setTranslatedText] = useState(null);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [activeTab, setActiveTab] = useState('chat');
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  // Fetch documents on mount
  useEffect(() => {
    fetchDocuments();
  }, []);

  // Auto scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${API_URL}/documents`);
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      alert('Failed to fetch documents. Make sure backend is running!');
    }
  };

  const uploadDocument = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        alert(`✅ Uploaded: ${data.filename} (${data.pages} pages)`);
        fetchDocuments();
      } else {
        const error = await response.json();
        alert(`❌ Upload failed: ${error.detail}`);
      }
    } catch (error) {
      console.error('Error uploading:', error);
      alert('Upload failed. Check backend connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      if (file.type === 'application/pdf') {
        uploadDocument(file);
      } else {
        alert('Only PDF files are allowed!');
      }
    });
    e.target.value = '';
  };

  const deleteDocument = async (docId) => {
    if (!window.confirm('Delete this document?')) return;

    try {
      const response = await fetch(`${API_URL}/documents/${docId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('Document deleted!');
        fetchDocuments();
      } else {
        alert('Failed to delete document');
      }
    } catch (error) {
      console.error('Error deleting:', error);
      alert('Delete failed');
    }
  };

  const askQuestion = async () => {
    if (!question.trim()) return;
    if (documents.length === 0) {
      alert('Please upload documents first!');
      return;
    }

    const userQuestion = question;
    setQuestion('');
    setLoading(true);

    try {
      const payload = {
        question: userQuestion,
        document_ids: selectedDocs.length > 0 ? selectedDocs : undefined
      };

      const response = await fetch(`${API_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        setChatHistory([...chatHistory, {
          question: userQuestion,
          answer: data.answer,
          sources: data.sources,
          timestamp: new Date().toISOString()
        }]);
      } else {
        const error = await response.json();
        alert(`Error: ${error.detail}`);
      }
    } catch (error) {
      console.error('Error asking question:', error);
      alert('Failed to get answer. Check backend.');
    } finally {
      setLoading(false);
    }
  };

  const viewPage = async (docId, pageNum, filename) => {
    try {
      setLoading(true);
      setSelectedPage({ docId, pageNum, filename });
      setPageText(null);
      setTranslatedText(null);
      setActiveTab('viewer');

      const response = await fetch(`${API_URL}/documents/${docId}/page/${pageNum}`);
      if (response.ok) {
        const data = await response.json();
        setPageText(data.text);
      } else {
        alert('Failed to fetch page');
      }
    } catch (error) {
      console.error('Error fetching page:', error);
      alert('Failed to load page');
    } finally {
      setLoading(false);
    }
  };

  const translatePage = async () => {
    if (!pageText) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/translate?target_language=en`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pageText)
      });

      if (response.ok) {
        const data = await response.json();
        setTranslatedText(data.translated);
      } else {
        alert('Translation failed');
      }
    } catch (error) {
      console.error('Error translating:', error);
      alert('Translation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>📁 Documents</h2>
        </div>

        <div className="upload-section">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="application/pdf"
            multiple
            style={{ display: 'none' }}
          />
          <button
            className="upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            📤 Upload PDFs
          </button>
        </div>

        <div className="documents-list">
          {documents.length === 0 ? (
            <p className="no-docs">No documents uploaded yet</p>
          ) : (
            documents.map(doc => (
              <div key={doc.id} className="doc-card">
                <div className="doc-info">
                  <strong>📄 {doc.filename}</strong>
                  <small>Pages: {doc.pages} | {doc.size_mb} MB</small>
                  <small className="doc-id">ID: {doc.id.substring(0, 12)}...</small>
                </div>
                <button
                  className="delete-btn"
                  onClick={() => deleteDocument(doc.id)}
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>

        <button className="refresh-btn" onClick={fetchDocuments}>
          🔄 Refresh
        </button>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="header">
          <h1>📚 Multilingual Document QA</h1>
          <p>Upload PDFs in any Indian language and ask questions in English!</p>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            💬 Chat
          </button>
          <button
            className={`tab ${activeTab === 'viewer' ? 'active' : ''}`}
            onClick={() => setActiveTab('viewer')}
          >
            📄 Page Viewer
          </button>
        </div>

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div className="chat-container">
            {documents.length > 0 && (
              <div className="doc-selector">
                <label>Search in documents (leave empty for all):</label>
                <div className="doc-checkboxes">
                  {documents.map(doc => (
                    <label key={doc.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedDocs.includes(doc.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDocs([...selectedDocs, doc.id]);
                          } else {
                            setSelectedDocs(selectedDocs.filter(id => id !== doc.id));
                          }
                        }}
                      />
                      {doc.filename}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="chat-messages">
              {chatHistory.length === 0 && (
                <div className="empty-chat">
                  <h3>👋 Welcome!</h3>
                  <p>Upload documents and start asking questions</p>
                </div>
              )}

              {chatHistory.map((chat, idx) => (
                <div key={idx} className="chat-exchange">
                  <div className="message user-message">
                    <strong>You:</strong>
                    <p>{chat.question}</p>
                  </div>

                  <div className="message assistant-message">
                    <strong>Assistant:</strong>
                    <p>{chat.answer}</p>

                    {chat.sources && chat.sources.length > 0 && (
                      <div className="sources">
                        <strong>📌 Sources:</strong>
                        {chat.sources.map((source, sIdx) => (
                          <div key={sIdx} className="source-card">
                            <span>📄 {source.filename} - Page {source.page_number}</span>
                            <button
                              className="view-btn"
                              onClick={() => viewPage(source.document_id, source.page_number, source.filename)}
                            >
                              View
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-input-container">
              <input
                type="text"
                className="chat-input"
                placeholder="Ask a question about your documents..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && askQuestion()}
                disabled={loading || documents.length === 0}
              />
              <button
                className="send-btn"
                onClick={askQuestion}
                disabled={loading || !question.trim() || documents.length === 0}
              >
                {loading ? '⏳' : '🚀'} Send
              </button>
            </div>
          </div>
        )}

        {/* Page Viewer Tab */}
        {activeTab === 'viewer' && (
          <div className="viewer-container">
            {selectedPage ? (
              <>
                <div className="viewer-header">
                  <button
                    className="back-btn"
                    onClick={() => {
                      setSelectedPage(null);
                      setPageText(null);
                      setTranslatedText(null);
                    }}
                  >
                    🔙 Back
                  </button>
                  <h3>📄 {selectedPage.filename} - Page {selectedPage.pageNum}</h3>
                </div>

                {pageText && (
                  <>
                    <div className="page-content">
                      <h4>Original Text</h4>
                      <div className="text-viewer">
                        {pageText}
                      </div>
                    </div>

                    <button
                      className="translate-btn"
                      onClick={translatePage}
                      disabled={loading}
                    >
                      🌐 Translate to English
                    </button>

                    {translatedText && (
                      <div className="page-content">
                        <h4>Translated Text (English)</h4>
                        <div className="text-viewer">
                          {translatedText}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {loading && <div className="loader">Loading page...</div>}
              </>
            ) : (
              <div className="empty-viewer">
                <h3>👆 No page selected</h3>
                <p>Click "View" on any source in the chat to see page content here</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;