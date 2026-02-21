/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const backend = process.env.BACKEND_URL || 'http://localhost:5000';
    return [
      { source: '/dashboard/:path*', destination: `${backend}/dashboard/:path*` },
      { source: '/forecast/:path*',  destination: `${backend}/forecast/:path*`  },
      { source: '/replay/:path*',    destination: `${backend}/replay/:path*`    },
    ];
  },
};

export default nextConfig;
