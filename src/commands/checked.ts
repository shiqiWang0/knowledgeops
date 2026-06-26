import path from "node:path";
import fs from "node:fs/promises";
import fg from "fast-glob";
import matter from "gray-matter";

const VAULT_DIR = process.env.VAULT_DIR;
const REVIEW_DIR = process.env.REVIEW_DIR || "30_editorial_review";

if (!VAULT_DIR) {
    throw new Error("Missing env: VAULT_DIR");
}

const vaultRoot = path.resolve(VAULT_DIR);
const reviewRoot = path.join(vaultRoot, REVIEW_DIR);
const manifestDir = path.join(vaultRoot, "manifest");
const reviewIndexPath = path.join(manifestDir, "review-index.json");

type ReviewIndexItem = {
    title: string;
    displayTitle?: string;
    draftPath: string;
    reviewPath: string;
    sourcePath?: string;
    targetPath?: string;
    submittedAt: string;
    checkedAt?: string;
    status: "pending" | "ready";
};

async function pathExists(filePath: string) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function readReviewIndex(): Promise<ReviewIndexItem[]> {
    if (!(await pathExists(reviewIndexPath))) {
        return [];
    }

    const raw = await fs.readFile(reviewIndexPath, "utf-8");
    return JSON.parse(raw) as ReviewIndexItem[];
}

async function writeReviewIndex(items: ReviewIndexItem[]) {
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(reviewIndexPath, JSON.stringify(items, null, 2), "utf-8");
}

async function main() {
    const reviewFiles = await fg("**/*.md", {
        cwd: reviewRoot,
        absolute: true,
        onlyFiles: true,
    });

    const reviewIndex = await readReviewIndex();
    const reviewIndexMap = new Map(reviewIndex.map((item) => [item.reviewPath, item]));

    let scanned = 0;
    let checked = 0;
    let skipped = 0;

    for (const reviewAbsPath of reviewFiles) {
        scanned++;

        const raw = await fs.readFile(reviewAbsPath, "utf-8");
        const parsed = matter(raw);

        const isPendingReview =
            parsed.data.status === "review" && parsed.data.review_status === "pending";

        const isManualReady =
            parsed.data.status === "ready" && parsed.data.review_status === "ready";


        if (!isPendingReview && !isManualReady) {
            skipped++;
            continue;
        }

        const checkedAt = parsed.data.checked_at || new Date().toISOString();

        const nextData = isPendingReview
            ? {
                ...parsed.data,
                status: "ready",
                review_status: "ready",
                checked_at: checkedAt,
            }
            : {
                ...parsed.data,
                checked_at: checkedAt,
            };


        const nextContent = matter.stringify(parsed.content.trim() + "\n", nextData);
        await fs.writeFile(reviewAbsPath, nextContent, "utf-8");

        const reviewRelPath = path.relative(vaultRoot, reviewAbsPath);
        const item = reviewIndexMap.get(reviewRelPath);

        if (item) {
            reviewIndexMap.set(reviewRelPath, {
                ...item,
                status: "ready",
                checkedAt,
            });
        } else {
            reviewIndexMap.set(reviewRelPath, {
                title: parsed.data.title || path.basename(reviewAbsPath, ".md"),
                displayTitle: parsed.data.display_title,
                draftPath: "",
                reviewPath: reviewRelPath,
                sourcePath: parsed.data.source_path,
                targetPath: parsed.data.target_path,
                submittedAt: parsed.data.submitted_at || "",
                checkedAt,
                status: "ready",
            });
        }

        checked++;

        console.log(`Checked: ${reviewRelPath}`);
    }

    await writeReviewIndex(Array.from(reviewIndexMap.values()));

    console.log("");
    console.log("Checked completed");
    console.log(`Scanned: ${scanned}`);
    console.log(`Checked: ${checked}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Review index: ${reviewIndexPath}`);
}

main().catch((error) => {
    console.error("Checked failed");
    console.error(error);
    process.exit(1);
});