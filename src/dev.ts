// Dev runner for qwen-provider: start the simple proxy server
import { simpleProxyServer } from './server';

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';

(async () => {
	try {
		const portsToTry = [port, 8081, 3000, 0];
		const hostsToTry = [host, '0.0.0.0'];
		let started = false;
		for (const h of hostsToTry) {
			for (const p of portsToTry) {
				console.log(`Trying to start server on ${h}:${p}`);
				started = await simpleProxyServer.start(p, h);
				if (started) {
					console.log(`qwen-provider running in dev mode on ${h}:${p}`);
					break;
				}
				console.warn(`Port ${p} unavailable on ${h}, trying next`);
			}
			if (started) break;
		}
		if (!started) {
			console.error('Failed to start server on all tried ports');
			process.exit(1);
		}
	} catch (err) {
		console.error('Dev server error:', err);
		process.exit(1);
	}
})();

process.on('SIGINT', async () => {
	console.log('Stopping server...');
	await simpleProxyServer.stop();
	process.exit(0);
});

export {};
