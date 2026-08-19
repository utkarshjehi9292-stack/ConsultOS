/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / subprocess-spawning packages must stay external to the server bundle.
  // The Claude Agent SDK shells out to the Claude Code runtime, so it (and the
  // native SQLite driver) cannot be bundled by webpack.
  serverExternalPackages: ["better-sqlite3", "@anthropic-ai/claude-agent-sdk"],
  // Serve the designed standalone landing (public/app.html, wired to /api/analyze)
  // at the site root. The original React form remains available at /classic.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/app.html" },
        { source: "/classic", destination: "/" },
      ],
    };
  },
};

export default nextConfig;
