import { initializeParams } from './helpers/init';
import { vlessOverWSHandler } from './protocols/vless';
import { trojanOverWSHandler } from './protocols/trojan';
import { updateWarpConfigs } from './kv/handlers';
import { logout, resetPassword, login } from './authentication/auth';
import { renderErrorPage } from './pages/error';
import { getXrayCustomConfigs, getXrayWarpConfigs } from './cores-configs/xray';
import { getSingBoxCustomConfig, getSingBoxWarpConfig } from './cores-configs/sing-box';
import { getClashNormalConfig, getClashWarpConfig } from './cores-configs/clash';
import { getNormalConfigs } from './cores-configs/normalConfigs';
import { fallback, getMyIP, handlePanel } from './helpers/helpers';
import { renderSecretsPage } from './pages/secrets';

export default {
    async fetch(request, env) {
        try {    
            initializeParams(request, env);
            const upgradeHeader = request.headers.get('Upgrade');
            if (!upgradeHeader || upgradeHeader !== 'websocket') {            
                switch (globalThis.pathName) {                    
                    case '/update-warp':
                        return await updateWarpConfigs(request, env);

                    case `/sub/${globalThis.userID}`:
                        if (globalThis.client === 'sfa') return await getSingBoxCustomConfig(request, env, false);
                        if (globalThis.client === 'clash') return await getClashNormalConfig(request, env);
                        if (globalThis.client === 'xray') return await getXrayCustomConfigs(request, env, false);
                        return await getNormalConfigs(request, env);                        

                    case `/fragsub/${globalThis.userID}`:
                        return globalThis.client === 'hiddify'
                            ? await getSingBoxCustomConfig(request, env, true)
                            : await getXrayCustomConfigs(request, env, true);

                    case `/warpsub/${globalThis.userID}`:
                        if (globalThis.client === 'clash') return await getClashWarpConfig(request, env);   
                        if (globalThis.client === 'singbox' || globalThis.client === 'hiddify') return await getSingBoxWarpConfig(request, env, globalThis.client);
                        return await getXrayWarpConfigs(request, env, globalThis.client);

                    case '/panel':
                        return await handlePanel(request, env);
                                                      
                    case '/login':
                        return await login(request, env);
                    
                    case '/logout':                        
                        return logout();        

                    case '/panel/password':
                        return await resetPassword(request, env);
                    
                    case '/my-ip':
                        return await getMyIP(request);

                    case '/secrets':
                        return await renderSecretsPage();

                    default:
                        let nginxWelcomePage = `<!DOCTYPE html>
                            <html>
                            <head>
                            <title>Welcome to nginx!</title>
                            <style>
                            html { color-scheme: light dark; }
                            body { width: 35em; margin: 0 auto;
                            font-family: Tahoma, Verdana, Arial, sans-serif; }
                            </style>
                            </head>
                            <body>
                            <h1>Welcome to nginx!</h1>
                            <p>If you see this page, the nginx web server is successfully installed and
                            working. Further configuration is required.</p>
                            
                            <p>For online documentation and support please refer to
                            <a href="http://nginx.org/">nginx.org</a>.<br/>
                            Commercial support is available at
                            <a href="http://nginx.com/">nginx.com</a>.</p>
                            
                            <p><em>Thank you for using nginx.</em></p>
                            </body>
                            </html>`
                        return new Response(nginxWelcomePage, {
                            status: 200,
                            headers:
                            {
                                'Content-Type': 'text/html',
                                'Server': 'nginx/1.20.2',
                                'Access-Control-Allow-Origin': url.origin,
                                'Access-Control-Allow-Methods': 'GET, POST',
                                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                                'X-Content-Type-Options': 'nosniff',
                                'X-Frame-Options': 'DENY',
                                'Referrer-Policy': 'strict-origin-when-cross-origin',
                                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                                'CDN-Cache-Control': 'no-store'
                            }
                        });
                }
            } else {
                return globalThis.pathName.startsWith('/tr') 
                    ? await trojanOverWSHandler(request) 
                    : await vlessOverWSHandler(request);
            }
        } catch (err) {
            return await renderErrorPage(err);
        }
    }
};