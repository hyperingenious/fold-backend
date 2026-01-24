import "dotenv/config";
import { prisma } from "../src/config/database.js";
import { hashPassword } from "../src/utils/password.js";

const videos = [
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/videoplayback%20%283%29.mp4",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/videoplayback%20%284%29.mp4",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/bablesh-bNrGuCB1VLBnkjOwTYsxg86va3uTws.mp4"
];

const images = [
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/1-llBttGXF2kvot7YHz0XLt5yFCldbUx.png",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/10-2HFRv4Pzg7t3dAwdUfexHU91MWl7xk.png",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/100-S3PlR1pscjVqKKYqZwjizC8VOFMb0c.png",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/12-0afFeP9R1Tk41dK5wvBJnONR18u0yr.png",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/14-Uh3S3l0RkwHkWIGHXf47SauHsZOSlT.png",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/15-rvfuQ9s2BN25V0Cq8uHXTxD1XCCOH9.png"
];

const audios = [
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/Adri%C3%A1n%20Berenguer%20-%20Premiere.mp3",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/BalloonPlanet%20-%20Iron%20Caravan.mp3",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/Roie%20Shpigler%20-%20Until%20We%E2%80%99re%20Gone.mp3",
    "https://viqwjhprxs3j5sad.public.blob.vercel-storage.com/cat-images/Yehezkel%20Raz%20-%20Ballerina.mp3"
];

const moods = [-2, -1, 0, 1, 2];

// Helper to get random item
function getRandomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Helper to get random date
function getRandomDate(start: Date, end: Date): Date {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function main() {
    console.log("🌱 Starting seed...");

    // 1. Create User
    const email = "demo@example.com";
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
        console.log("Creating demo user...");
        const passwordHash = await hashPassword("Password123!");
        user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                name: "Demo User",
                status: "active",
                createdAt: new Date("2025-01-01"),
            },
        });
        console.log(`User created: ${user.id} (demo@example.com / Password123!)`);
    } else {
        console.log(`User already exists: ${user.id}`);
    }

    // 2. Create Memories (50 items)
    console.log("Creating 50 memories...");
    for (let i = 0; i < 50; i++) {
        const hasMedia = Math.random() > 0.3; // 70% chance of having media
        let videoUrl: string | undefined = undefined;
        let imageUrl: string | undefined = undefined;
        let audioUrl: string | undefined = undefined;

        // Pick one media type if hasMedia
        if (hasMedia) {
            const rand = Math.random();
            if (rand < 0.33) videoUrl = getRandomItem(videos);
            else if (rand < 0.66) imageUrl = getRandomItem(images);
            else audioUrl = getRandomItem(audios);
        }

        const mood = getRandomItem(moods);

        await prisma.memory.create({
            data: {
                userId: user.id,
                mood: mood,
                textContent: `Memory #${i + 1}: Feeling ${mood} today. ${hasMedia ? 'Attached some media.' : 'Just thoughts.'}`,
                visibility: "private",
                createdAt: getRandomDate(new Date(2025, 0, 1), new Date()),
                videoUrl,
                imageUrl,
                audioUrl,
                locationName: Math.random() > 0.8 ? "San Francisco, CA" : undefined,
                latitude: Math.random() > 0.8 ? 37.7749 : undefined,
                longitude: Math.random() > 0.8 ? -122.4194 : undefined,
            },
        });
    }
    console.log("Memories created.");

    // 3. Create Stories (15 stories)
    console.log("Creating 15 stories...");
    for (let i = 0; i < 15; i++) {
        const story = await prisma.story.create({
            data: {
                userId: user.id,
                title: `My Adventures - Chapter ${i + 1}`,
                visibility: "private",
                createdAt: getRandomDate(new Date(2025, 0, 1), new Date()),
            },
        });

        // Add 1-5 pages per story
        const numPages = Math.floor(Math.random() * 5) + 1;
        for (let p = 1; p <= numPages; p++) {
            // Determine media for this page
            const hasVideo = Math.random() < 0.2;
            const hasImage = !hasVideo && Math.random() < 0.4;
            const hasAudio = !hasVideo && !hasImage && Math.random() < 0.3;

            const pageVideos = hasVideo ? [{ videoUrl: getRandomItem(videos) }] : [];
            const pageImages = hasImage ? [{ imageUrl: getRandomItem(images) }] : [];
            const pageAudios = hasAudio ? [{ audioUrl: getRandomItem(audios) }] : [];

            await prisma.storyPage.create({
                data: {
                    storyId: story.id,
                    pageNumber: p,
                    pageText: `Page ${p}: Exploring the world.`,
                    isAttachedVideos: hasVideo,
                    isAttachedImages: hasImage,
                    isAttachedAudios: hasAudio,
                    videos: hasVideo ? { create: pageVideos } : undefined,
                    images: hasImage ? { create: pageImages } : undefined,
                    audios: hasAudio ? { create: pageAudios } : undefined,
                },
            });
        }
    }
    console.log("Stories created.");

    // 4. Create Badges
    console.log("Creating badges...");
    const badges = [
        { name: "First Post", slug: "first-post" },
        { name: "Memory Maker", slug: "memory-maker" },
        { name: "Storyteller", slug: "story-teller" },
        { name: "Vlogger", slug: "vlogger" },
        { name: "Photographer", slug: "photographer" },
    ];

    for (const b of badges) {
        const slug = `${b.slug}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await prisma.badge.create({
            data: {
                userId: user.id,
                name: b.name,
                slug: slug,
                description: `Awarded for being a great ${b.name}`,
                iconUrl: getRandomItem(images),
            },
        });
    }
    console.log("Badges created.");

    console.log("✅ Seed completed successfully!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
