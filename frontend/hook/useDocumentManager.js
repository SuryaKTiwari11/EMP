import { useState, useEffect, useCallback, useRef } from "react";
import io from "socket.io-client";
import { documentApi } from "../src/front2backconnect/api.js";
import useAuthStore from "../src/store/authStore.js";

export default function useDocumentManager() {
  const { user } = useAuthStore();
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState("resume");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastUploadedDocId, setLastUploadedDocId] = useState(null);
  const [progress, setProgress] = useState(0);
  const socketRef = useRef(null);

  const loadDocuments = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // Updated to use S3 documents API
      const response = await documentApi.list();
      console.log("📄 Documents API response:", response.data);
      // S3 API returns data in response.data.data, not response.data.documents
      setDocuments(response.data.data || []);
    } catch (error) {
      console.error("Load documents error:", error);
      setMessage("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!user) return;
    if (!socketRef.current) {
      socketRef.current = io("http://localhost:3000");
    }
    const socket = socketRef.current;
    const progressMap = {
      starting: 10,
      movingFile: 40,
      updatingDb: 80,
      done: 100,
      error: 0,
    };
    const onProgress = ({ documentId, status }) => {
      if (lastUploadedDocId && documentId === lastUploadedDocId) {
        setProgress(progressMap[status] || 0);
        setMessage(`Status: ${status}`);
        if (status === "done" || status === "error") {
          setTimeout(() => setProgress(0), 1500);

          loadDocuments();
        }
      }
    };
    socket.on("doc-progress", onProgress);
    return () => {
      socket.off("doc-progress", onProgress);
    };
  }, [user, lastUploadedDocId, loadDocuments]);

  // Upload handler
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return setMessage("Please select a file");
    setUploading(true);
    setMessage("Uploading...");
    setProgress(5);
    try {
      const formData = new FormData();
      formData.append("document", file);
      formData.append("documentType", docType);
      const res = await documentApi.upload(formData);
      setMessage("Upload successful! Processing...");
      setFile(null);
      if (e.target && typeof e.target.reset === "function") e.target.reset();
      if (res.data?.document?.id) setLastUploadedDocId(res.data.document.id);

      if (!socketRef.current) {
        socketRef.current = io("http://localhost:3000");
        setTimeout(() => loadDocuments(), 200);
      }
    } catch (error) {
      setMessage("Upload failed: " + error.message);
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId) => {
    try {
      setMessage("Deleting document...");
      await documentApi.delete(docId);
      setMessage("Document deleted successfully");
      // Immediately refresh the document list
      await loadDocuments();
    } catch (error) {
      console.error("Delete error:", error);
      if (error.response?.status === 404) {
        setMessage("Document already deleted");
        // Refresh list to sync state
        await loadDocuments();
      } else {
        setMessage("Delete failed: " + (error.response?.data?.message || error.message));
      }
    }
  };

  const handleDownload = async (docId, fileName) => {
    try {
      setMessage("Preparing download...");
      // Get S3 download URL
      const response = await documentApi.download(docId);

      if (response.data.success && response.data.downloadUrl) {
        // Open S3 presigned URL in new tab or trigger download
        const link = document.createElement("a");
        link.href = response.data.downloadUrl;
        link.download = fileName || response.data.filename;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setMessage(`Download started: ${fileName || response.data.filename}`);
      } else {
        throw new Error(response.data.message || "Failed to get download URL");
      }
    } catch (error) {
      console.error("Download error:", error);
      if (error.response?.status === 404) {
        setMessage("Document not found");
      } else if (error.response?.status === 403) {
        setMessage("Not authorized to download this document");
      } else {
        setMessage("Download failed: " + (error.response?.data?.message || error.message));
      }
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return loadDocuments();
    try {
      // Use S3 search endpoint
      const response = await documentApi.search(searchQuery);
      setDocuments(response.data.documents || response.data || []);
    } catch (error) {
      console.error("Search error:", error);
      setMessage("Search failed");
    }
  };

  return {
    user,
    file,
    setFile,
    docType,
    setDocType,
    uploading,
    message,
    progress,
    documents,
    loading,
    searchQuery,
    setSearchQuery,
    handleUpload,
    handleDelete,
    handleDownload,
    handleSearch,
    loadDocuments,
    lastUploadedDocId,
  };
}
