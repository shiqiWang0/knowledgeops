import { runCommand } from ".";

export async function runGit(args: string[], targetRepoRoot: string) {
    return runCommand("git", args, {
        cwd: targetRepoRoot,
        inherit: true,
    });
}

export async function getGitOutput(args: string[], targetRepoRoot: string) {
    return runCommand("git", args, {
        cwd: targetRepoRoot,
    });
}

export async function runGh(args: string[], targetRepoRoot: string) {
    return runCommand("gh", args, {
        cwd: targetRepoRoot,
    });
}

export async function checkTargetRepoGitIdentity(targetRepoRoot: string) {
    const name = await getGitOutput(["config", "user.name"], targetRepoRoot).catch(() => "");
    const email = await getGitOutput(["config", "user.email"], targetRepoRoot).catch(() => "");

    if (!name || !email) {
        throw new Error(`Target repository has no Git identity configured.

Run inside target repo:

cd "${targetRepoRoot}"
git config user.name "Your Name"
git config user.email "you@example.com"
`);
    }

    console.log("Target repo git identity:");
    console.log(`  user.name  = ${name}`);
    console.log(`  user.email = ${email}`);
}

export async function checkGhAuth(targetRepoRoot: string) {
    try {
        await runCommand("gh", ["auth", "status"], {
            cwd: targetRepoRoot,
        });

        console.log("GitHub CLI auth checked.");
    } catch {
        throw new Error(`GitHub CLI is not authenticated.

Run:

gh auth login
`);
    }
}