import { Client, Storage, ID } from "node-appwrite";

// Initialize Appwrite Client
const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1")
    .setProject(process.env.APPWRITE_PROJECT_ID || "")
    .setKey(process.env.APPWRITE_API_KEY || "");

// Initialize Storage service
export const storage = new Storage(client);

// Bucket ID for file uploads
export const BUCKET_ID = process.env.APPWRITE_BUCKET_ID || "";

// Helper to generate unique file IDs
export const generateFileId = () => ID.unique();

// Helper to get file URL
export const getFileUrl = (fileId: string): string => {
    const endpoint = process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
    const projectId = process.env.APPWRITE_PROJECT_ID || "";
    return `${endpoint}/storage/buckets/${BUCKET_ID}/files/${fileId}/view?project=${projectId}`;
};

// Helper to get file preview URL (for images)
export const getFilePreviewUrl = (
    fileId: string,
    width?: number,
    height?: number,
    quality?: number
): string => {
    const endpoint = process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
    const projectId = process.env.APPWRITE_PROJECT_ID || "";

    let url = `${endpoint}/storage/buckets/${BUCKET_ID}/files/${fileId}/preview?project=${projectId}`;

    if (width) url += `&width=${width}`;
    if (height) url += `&height=${height}`;
    if (quality) url += `&quality=${quality}`;

    return url;
};

// Helper to get file download URL
export const getFileDownloadUrl = (fileId: string): string => {
    const endpoint = process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
    const projectId = process.env.APPWRITE_PROJECT_ID || "";
    return `${endpoint}/storage/buckets/${BUCKET_ID}/files/${fileId}/download?project=${projectId}`;
};
