import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { getProject } from './store.js';
import { getUserId } from './auth.js';
import type { FastifyRequest } from 'fastify';

async function resolveInProject(req: FastifyRequest, projectId: string, rel: string) {
  const uid = getUserId(req);
  if (!uid) throw Object.assign(new Error('unauthorized'), { code: 401 });
  const project = await getProject(uid, projectId);
  if (!project) throw Object.assign(new Error('project not found'), { code: 404 });
  const root = project.path;
  const abs = path.resolve(root, (rel || '').replace(/^\/+/, ''));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw Object.assign(new Error('path escapes project root'), { code: 400 });
  }
  return { project, abs };
}

export function registerFsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { project?: string; path?: string } }>(
    '/api/fs/list',
    async (req, reply) => {
      const projectId = req.query.project;
      if (!projectId) return reply.code(400).send({ error: 'project required' });
      let abs: string;
      try {
        ({ abs } = await resolveInProject(req, projectId, req.query.path ?? ''));
      } catch (e: any) {
        return reply.code(e.code ?? 400).send({ error: e.message });
      }
      const stat = await fs.stat(abs);
      if (!stat.isDirectory()) return reply.code(400).send({ error: 'not a directory' });
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          path: path.join(req.query.path ?? '', e.name),
          isDir: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { path: req.query.path ?? '', items };
    },
  );

  app.get<{ Querystring: { project?: string; path?: string } }>(
    '/api/fs/file',
    async (req, reply) => {
      const projectId = req.query.project;
      const rel = req.query.path;
      if (!projectId || !rel) return reply.code(400).send({ error: 'project and path required' });
      let abs: string;
      try {
        ({ abs } = await resolveInProject(req, projectId, rel));
      } catch (e: any) {
        return reply.code(e.code ?? 400).send({ error: e.message });
      }
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return reply.code(400).send({ error: 'not a file' });
      if (stat.size > 20 * 1024 * 1024) {
        return reply.code(413).send({ error: 'file too large (>20MB)' });
      }
      const type = mime.lookup(abs) || 'application/octet-stream';
      reply.header('Content-Type', type);
      reply.header('Content-Length', String(stat.size));
      reply.header('Cache-Control', 'no-store');
      return reply.send(createReadStream(abs));
    },
  );

  // Raw file serving with the project + path encoded in the URL path itself,
  // not the query string. This is what lets HTML files load their relative
  // resources: opening /raw/<pid>/dir/page.html in a new window resolves a
  // `<link href="./style.css">` to /raw/<pid>/dir/style.css naturally — the
  // /api/fs/file?path=... shape can't do that because relative URL resolution
  // strips the query.
  app.get<{ Params: { projectId: string; '*': string } }>(
    '/raw/:projectId/*',
    async (req, reply) => {
      const projectId = req.params.projectId;
      const rel = req.params['*'] ?? '';
      let abs: string;
      try {
        ({ abs } = await resolveInProject(req, projectId, rel));
      } catch (e: any) {
        return reply.code(e.code ?? 400).send({ error: e.message });
      }
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return reply.code(400).send({ error: 'not a file' });
      if (stat.size > 50 * 1024 * 1024) {
        return reply.code(413).send({ error: 'file too large (>50MB)' });
      }
      const type = mime.lookup(abs) || 'application/octet-stream';
      reply.header('Content-Type', type);
      reply.header('Content-Length', String(stat.size));
      reply.header('Cache-Control', 'no-store');
      return reply.send(createReadStream(abs));
    },
  );

  app.get<{ Querystring: { project?: string; path?: string } }>(
    '/api/fs/stat',
    async (req, reply) => {
      const projectId = req.query.project;
      const rel = req.query.path;
      if (!projectId || !rel) return reply.code(400).send({ error: 'project and path required' });
      let abs: string;
      try {
        ({ abs } = await resolveInProject(req, projectId, rel));
      } catch (e: any) {
        return reply.code(e.code ?? 400).send({ error: e.message });
      }
      const stat = await fs.stat(abs);
      const type = stat.isDirectory() ? 'dir' : mime.lookup(abs) || 'application/octet-stream';
      return { path: rel, size: stat.size, isDir: stat.isDirectory(), mime: type };
    },
  );
}
