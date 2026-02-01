import { Hono } from "hono";
import { InputFile } from "node-appwrite/file";
import {
    storage,
    BUCKET_ID,
    generateFileId,
    getFileUrl,
    getFilePreviewUrl,
    getFileDownloadUrl,
} from "../lib/appwrite";
import { requireAuth } from "../lib/middleware";

export const uploadRoutes = new Hono();

// =============================================================================
// Types
// =============================================================================

interface UploadedFile {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
    previewUrl?: string;
    downloadUrl: string;
    createdAt: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

const isImageMimeType = (mimeType: string): boolean => {
    return mimeType.startsWith("image/");
};

const formatFileResponse = (file: any): UploadedFile => {
    const isImage = isImageMimeType(file.mimeType);

    return {
        id: file.$id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.sizeOriginal,
        url: getFileUrl(file.$id),
        previewUrl: isImage ? getFilePreviewUrl(file.$id, 400, 400, 80) : undefined,
        downloadUrl: getFileDownloadUrl(file.$id),
        createdAt: file.$createdAt,
    };
};

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /api/upload
 * Upload a single file
 * Requires authentication
 */
uploadRoutes.post("/", requireAuth, async (c) => {
    try {
        const body = await c.req.parseBody();
        const file = body["file"];

        if (!file || !(file instanceof File)) {
            return c.json(
                {
                    success: false,
                    error: "No file provided. Please upload a file with key 'file'",
                },
                400
            );
        }

        // Convert File to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Create InputFile for Appwrite
        const inputFile = InputFile.fromBuffer(buffer, file.name);

        // Upload to Appwrite
        const uploadedFile = await storage.createFile(
            BUCKET_ID,
            generateFileId(),
            inputFile
        );

        return c.json({
            success: true,
            message: "File uploaded successfully",
            data: formatFileResponse(uploadedFile),
        });
    } catch (error: any) {
        console.error("Upload error:", error);
        return c.json(
            {
                success: false,
                error: error.message || "Failed to upload file",
            },
            500
        );
    }
});

/**
 * POST /api/upload/multiple
 * Upload multiple files (up to 10)
 * Requires authentication
 */
uploadRoutes.post("/multiple", requireAuth, async (c) => {
    try {
        const body = await c.req.parseBody({ all: true });
        const files = body["files"];

        if (!files) {
            return c.json(
                {
                    success: false,
                    error: "No files provided. Please upload files with key 'files'",
                },
                400
            );
        }

        // Handle both single and multiple files
        const fileArray = Array.isArray(files) ? files : [files];

        // Filter valid files
        const validFiles = fileArray.filter((f) => f instanceof File) as File[];

        if (validFiles.length === 0) {
            return c.json(
                {
                    success: false,
                    error: "No valid files provided",
                },
                400
            );
        }

        if (validFiles.length > 10) {
            return c.json(
                {
                    success: false,
                    error: "Maximum 10 files allowed per upload",
                },
                400
            );
        }

        // Upload all files
        const uploadPromises = validFiles.map(async (file) => {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const inputFile = InputFile.fromBuffer(buffer, file.name);

            return storage.createFile(BUCKET_ID, generateFileId(), inputFile);
        });

        const uploadedFiles = await Promise.all(uploadPromises);

        return c.json({
            success: true,
            message: `${uploadedFiles.length} file(s) uploaded successfully`,
            data: uploadedFiles.map(formatFileResponse),
        });
    } catch (error: any) {
        console.error("Multiple upload error:", error);
        return c.json(
            {
                success: false,
                error: error.message || "Failed to upload files",
            },
            500
        );
    }
});

/**
 * POST /api/upload/avatar
 * Upload user avatar (image only, max 5MB, resized)
 * Requires authentication
 */
uploadRoutes.post("/avatar", requireAuth, async (c) => {
    try {
        const body = await c.req.parseBody();
        const file = body["avatar"];

        if (!file || !(file instanceof File)) {
            return c.json(
                {
                    success: false,
                    error: "No avatar provided. Please upload an image with key 'avatar'",
                },
                400
            );
        }

        // Validate image type
        if (!file.type.startsWith("image/")) {
            return c.json(
                {
                    success: false,
                    error: "Only image files are allowed for avatars",
                },
                400
            );
        }

        // Validate size (5MB max)
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (file.size > maxSize) {
            return c.json(
                {
                    success: false,
                    error: "Avatar must be less than 5MB",
                },
                400
            );
        }

        // Convert File to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const inputFile = InputFile.fromBuffer(buffer, file.name);

        // Upload to Appwrite
        const uploadedFile = await storage.createFile(
            BUCKET_ID,
            generateFileId(),
            inputFile
        );

        // Return with preview URLs for different sizes
        return c.json({
            success: true,
            message: "Avatar uploaded successfully",
            data: {
                id: uploadedFile.$id,
                name: uploadedFile.name,
                mimeType: uploadedFile.mimeType,
                size: uploadedFile.sizeOriginal,
                url: getFileUrl(uploadedFile.$id),
                thumbnails: {
                    small: getFilePreviewUrl(uploadedFile.$id, 50, 50, 80),
                    medium: getFilePreviewUrl(uploadedFile.$id, 150, 150, 80),
                    large: getFilePreviewUrl(uploadedFile.$id, 400, 400, 80),
                },
                createdAt: uploadedFile.$createdAt,
            },
        });
    } catch (error: any) {
        console.error("Avatar upload error:", error);
        return c.json(
            {
                success: false,
                error: error.message || "Failed to upload avatar",
            },
            500
        );
    }
});

/**
 * GET /api/upload/:fileId
 * Get file details by ID
 * Requires authentication
 */
uploadRoutes.get("/:fileId", requireAuth, async (c) => {
    try {
        const fileId = c.req.param("fileId");

        const file = await storage.getFile(BUCKET_ID, fileId);

        return c.json({
            success: true,
            data: formatFileResponse(file),
        });
    } catch (error: any) {
        console.error("Get file error:", error);

        if (error.code === 404) {
            return c.json(
                {
                    success: false,
                    error: "File not found",
                },
                404
            );
        }

        return c.json(
            {
                success: false,
                error: error.message || "Failed to get file",
            },
            500
        );
    }
});

/**
 * DELETE /api/upload/:fileId
 * Delete a file by ID
 * Requires authentication
 */
uploadRoutes.delete("/:fileId", requireAuth, async (c) => {
    try {
        const fileId = c.req.param("fileId");

        await storage.deleteFile(BUCKET_ID, fileId);

        return c.json({
            success: true,
            message: "File deleted successfully",
        });
    } catch (error: any) {
        console.error("Delete file error:", error);

        if (error.code === 404) {
            return c.json(
                {
                    success: false,
                    error: "File not found",
                },
                404
            );
        }

        return c.json(
            {
                success: false,
                error: error.message || "Failed to delete file",
            },
            500
        );
    }
});

/**
 * GET /api/upload/list
 * List all files in the bucket (paginated)
 * Requires authentication
 */
uploadRoutes.get("/list/all", requireAuth, async (c) => {
    try {
        const limit = parseInt(c.req.query("limit") || "25");
        const offset = parseInt(c.req.query("offset") || "0");

        const files = await storage.listFiles(BUCKET_ID);

        return c.json({
            success: true,
            data: {
                files: files.files.map(formatFileResponse),
                total: files.total,
                limit,
                offset,
            },
        });
    } catch (error: any) {
        console.error("List files error:", error);
        return c.json(
            {
                success: false,
                error: error.message || "Failed to list files",
            },
            500
        );
    }
});
