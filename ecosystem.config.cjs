module.exports = {
  apps: [
    {
      name: "invoice-backend",
      cwd: "/var/www/invoice/backend",
      script: "src/server.js",
      interpreter: "/usr/bin/node",
      env_file: "/var/www/invoice/backend/.env.production",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    },
    {
      name: "invoice-frontend",
      cwd: "/var/www/invoice",
      script: "serve",
      args: "-s frontend/dist -l 2001",
      interpreter: "none",
      env: {
        NODE_ENV: "production"
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
