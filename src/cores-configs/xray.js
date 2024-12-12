import { resolveDNS, isDomain } from '../helpers/helpers';
import { getConfigAddresses, extractWireguardParams, base64ToDecimal, generateRemark, randomUpperCase, getRandomPath } from './helpers';
import { getDataset } from '../kv/handlers';

async function buildXxrDNS (proxySettings, outboundAddrs, domainToStaticIPs, isWorkerLess, isWarp) { 
    const { 
        remoteDNS, 
        resolvedRemoteDNS, 
        localDNS, 
        vltFakeDNS, 
        enableIPv6, 
        warpFakeDNS,
        warpEnableIPv6,
        blockAds, 
        bypassIran, 
        bypassChina,
        blockPorn, 
        bypassRussia,
        customBypassRules,
        customBlockRules
    } = proxySettings;

    const bypassRules = [
        { rule: bypassIran, domain: "geosite:category-ir", ip: "geoip:ir" },
        { rule: bypassChina, domain: "geosite:cn", ip: "geoip:cn" },
        { rule: bypassRussia, domain: "geosite:category-ru", ip: "geoip:ru" }
    ];

    const blockRules = [
        { rule: blockAds, host: "geosite:category-ads-all" },
        { rule: blockAds, host: "geosite:category-ads-ir" },
        { rule: blockPorn, host: "geosite:category-porn" }
    ];

    const isFakeDNS = (vltFakeDNS && !isWarp) || (warpFakeDNS && isWarp);
    const isIPv6 = (enableIPv6 && !isWarp) || (warpEnableIPv6 && isWarp);
    const outboundDomains = outboundAddrs.filter(address => isDomain(address));
    const customBypassRulesDomains = customBypassRules.split(',').filter(address => isDomain(address));
    const customBlockRulesDomains = customBlockRules.split(',').filter(address => isDomain(address));
    const uniqueOutboundDomains = [...new Set(outboundDomains)];
    const isDomainRule = [...uniqueOutboundDomains, ...customBypassRulesDomains].length > 0;
    const isBypass = bypassIran || bypassChina || bypassRussia;
    const isBlock = blockAds || blockPorn || customBlockRulesDomains.length > 0;
    const finalRemoteDNS = isWorkerLess
        ? ["https://cloudflare-dns.com/dns-query"]
        : isWarp
            ? warpEnableIPv6 
                ? ["1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001"] 
                : ["1.1.1.1", "1.0.0.1"]
            : [remoteDNS];

    const dnsHost = {};
    if (isBlock) { 
        blockRules.forEach( ({ rule, host }) => {
            if (rule) dnsHost[host] = ["127.0.0.1"]; 
        }); 
        customBlockRulesDomains.forEach( domain => {
            dnsHost[`domain:${domain}`] = ["127.0.0.1"];
        });
    }
    
    const staticIPs = domainToStaticIPs ? await resolveDNS(domainToStaticIPs) : undefined;
    if (staticIPs) dnsHost[domainToStaticIPs] = enableIPv6 ? [...staticIPs.ipv4, ...staticIPs.ipv6] : staticIPs.ipv4;
    if (resolvedRemoteDNS.server && !isWorkerLess && !isWarp) dnsHost[resolvedRemoteDNS.server] = resolvedRemoteDNS.staticIPs;
    if (isWorkerLess) {
        const domains = ["cloudflare-dns.com", "cloudflare.com", "dash.cloudflare.com"];
        const resolved = await Promise.all(domains.map(resolveDNS));
        const hostIPv4 = resolved.flatMap(r => r.ipv4);
        const hostIPv6 = enableIPv6 ? resolved.flatMap(r => r.ipv6) : [];
        dnsHost["cloudflare-dns.com"] = [
            ...hostIPv4,
            ...hostIPv6
        ];
    }

    const hosts = Object.keys(dnsHost).length ? { hosts: dnsHost } : {};
    const dnsObject = {
        ...hosts,
        servers: finalRemoteDNS,
        queryStrategy: isIPv6 ? "UseIP" : "UseIPv4",
        tag: "dns",
    };
      
    if (isDomainRule) {  
        const outboundDomainRules = uniqueOutboundDomains.map(domain => `full:${domain}`);
        const bypassDomainRules = customBypassRulesDomains.map(domain => `domain:${domain}`);    
        dnsObject.servers.push({
            address: localDNS,
            domains: [...outboundDomainRules, ...bypassDomainRules],
            skipFallback: true
        });
    }

    const localDNSServer = {
        address: localDNS,
        domains: [],
        expectIPs: [],
        skipFallback: true
    };

    if (!isWorkerLess && isBypass) {
        bypassRules.forEach(({ rule, domain, ip }) => {
            if (rule) {
                localDNSServer.domains.push(domain);
                localDNSServer.expectIPs.push(ip);
            }
        });

        dnsObject.servers.push(localDNSServer);
    }

    if (isFakeDNS) {
        const fakeDNSServer = isBypass && !isWorkerLess 
            ? { address: "fakedns", domains: localDNSServer.domains } 
            : "fakedns";
        dnsObject.servers.unshift(fakeDNSServer);
    }

    return dnsObject;
}

function buildXxrRoutingRules (proxySettings, outboundAddrs, isChain, isBalancer, isWorkerLess, isWarp) {
    const {
        remoteDNS,
        localDNS,
        bypassLAN, 
        bypassIran, 
        bypassChina, 
        bypassRussia, 
        blockAds, 
        blockPorn, 
        blockUDP443,
        customBypassRules,
        customBlockRules 
    } = proxySettings;

    const geoRules = [ 
        { rule: bypassLAN, type: 'direct', domain: "geosite:private", ip: "geoip:private" },
        { rule: bypassIran, type: 'direct', domain: "geosite:category-ir", ip: "geoip:ir" },
        { rule: bypassChina, type: 'direct', domain: "geosite:cn", ip: "geoip:cn" },
        { rule: blockAds, type: 'block', domain: "geosite:category-ads-all" },
        { rule: blockAds, type: 'block', domain: "geosite:category-ads-ir" },
        { rule: blockPorn, type: 'block', domain: "geosite:category-porn" }
    ];
    const outboundDomains = outboundAddrs.filter(address => isDomain(address));
    const customBypassRulesTotal = customBypassRules ? customBypassRules.split(',') : [];
    const customBlockRulesTotal = customBlockRules ? customBlockRules.split(',') : [];
    const customBypassRulesDomains = customBypassRulesTotal.filter(address => isDomain(address));
    const isDomainRule = [...outboundDomains, ...customBypassRulesDomains].length > 0;
    const isBlock = blockAds || blockPorn || customBlockRulesTotal.length > 0;
    const isBypass = bypassIran || bypassChina || bypassRussia || customBypassRulesTotal.length > 0;
    const rules = [
        {
            inboundTag: [
                "dns-in"
            ],
            outboundTag: "dns-out",
            type: "field"
        },
        {
            inboundTag: [
                "socks-in",
                "http-in"
            ],
            port: "53",
            outboundTag: "dns-out",
            type: "field"
        }
    ];

    if (!isWorkerLess && (isDomainRule || isBypass)) rules.push({
        ip: [localDNS],
        port: "53",
        network: "udp",
        outboundTag: "direct",
        type: "field"
    });

    if (isBypass || isBlock) {
        const createRule = (type, outbound) => ({
            [type]: [],
            outboundTag: outbound,
            type: "field"
        });

        let domainDirectRule, ipDirectRule;
        if (!isWorkerLess) {
            domainDirectRule = createRule("domain", "direct");
            ipDirectRule = createRule("ip", "direct");
        }

        let domainBlockRule = createRule("domain", "block");
        let ipBlockRule = createRule("ip", "block");
        geoRules.forEach(({ rule, type, domain, ip }) => {
            if (rule) {
                if (type === 'direct') {
                    domainDirectRule?.domain.push(domain);
                    ipDirectRule?.ip?.push(ip);
                } else {
                    domainBlockRule.domain.push(domain);
                }
            }
        });

        customBypassRulesTotal.forEach( address => {
            if (isDomain(address)) { 
                domainDirectRule?.domain.push(`domain:${address}`);
            } else {
                ipDirectRule?.ip.push(address);
            }
        });
        
        customBlockRulesTotal.forEach( address => {
            if (isDomain(address)) { 
                domainBlockRule.domain.push(`domain:${address}`);
            } else {
                ipBlockRule.ip.push(address);
            }
        });
        
        if (!isWorkerLess) {
            domainDirectRule.domain.length && rules.push(domainDirectRule);
            ipDirectRule.ip.length && rules.push(ipDirectRule);
        }

        domainBlockRule.domain.length && rules.push(domainBlockRule);
        ipBlockRule.ip.length && rules.push(ipBlockRule);
    }

    blockUDP443 && rules.push({
        network: "udp",
        port: "443",
        outboundTag: "block",
        type: "field",
    });

    if (isChain) {
        const rule = {
            [isBalancer ? "balancerTag" : "outboundTag"]: isBalancer ? "all-proxy" : "proxy",
            type: "field"
        };
    
        if (!isWarp) {
            const url = new URL(remoteDNS);
            const remoteDNSServer = url.hostname;
            rules.push({
                [isDomain(remoteDNSServer) ? "domain" : "ip"]: [remoteDNSServer],
                network: "tcp",
                ...rule
            });
        } else {
            rules.push({
                network: "udp",
                port: "53",
                ...rule
            });
        }
    }

    if (isBalancer) {
        rules.push({
            network: "tcp,udp",
            balancerTag: "all",
            type: "field"
        });
    } else  {
        rules.push({
            network: "tcp,udp",
            outboundTag: isChain ? "chain" : isWorkerLess ? "fragment" : "proxy",
            type: "field"
        });
    }

    return rules;
}

function buildXxrXLOutbound (tag, address, port, host, sni, proxyIP, isFragment, allowInsecure, enableIPv6) {
    const outbound = {
        protocol: "vless",
        settings: {
            vnext: [
                {
                    address: address,
                    port: +port,
                    users: [
                        {
                            id: globalThis.userID,
                            encryption: "none",
                            level: 8
                        }
                    ]
                }
            ]
        },
        streamSettings: {
            network: "ws",
            security: "none",
            sockopt: {},
            wsSettings: {
                headers: {
                    Host: host,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
                },
                path: `/${getRandomPath(16)}${proxyIP ? `/${btoa(proxyIP)}` : ''}?ed=2560`
            }
        },
        tag: tag
    };

    if (globalThis.defaultHttpsPorts.includes(port)) {
        outbound.streamSettings.security = "tls";
        outbound.streamSettings.tlsSettings = {
            allowInsecure: allowInsecure,
            fingerprint: "randomized",
            alpn: ["h2", "http/1.1"],
            serverName: sni
        };
    }

    const sockopt = outbound.streamSettings.sockopt;
    if (isFragment) {
        sockopt.dialerProxy = "fragment";
    } else {
        sockopt.tcpKeepAliveIdle = 30;
        sockopt.tcpNoDelay = true;
        sockopt.domainStrategy = enableIPv6 ? "UseIPv4v6" : "UseIPv4";
    }
    
    return outbound;
}

function buildXxrTOutbound (tag, address, port, host, sni, proxyIP, isFragment, allowInsecure, enableIPv6) {
    const outbound = {
        protocol: "trojan",
        settings: {
            servers: [
                {
                    address: address,
                    port: +port,
                    password: globalThis.ttjPasswd,
                    level: 8
                }
            ]
        },
        streamSettings: {
            network: "ws",
            security: "none",
            sockopt: {},
            wsSettings: {
                headers: {
                    Host: host
                },
                path: `/tr${getRandomPath(16)}${proxyIP ? `/${btoa(proxyIP)}` : ''}?ed=2560`
            }
        },
        tag: tag
    };

    if (globalThis.defaultHttpsPorts.includes(port)) {
        outbound.streamSettings.security = "tls";
        outbound.streamSettings.tlsSettings = {
            allowInsecure: allowInsecure,
            fingerprint: "randomized",
            alpn: ["h2", "http/1.1"],
            serverName: sni
        };
    }

    const sockopt = outbound.streamSettings.sockopt;
    if (isFragment) {
        sockopt.dialerProxy = "fragment";
    } else {
        sockopt.tcpKeepAliveIdle = 30;
        sockopt.tcpNoDelay = true;
        sockopt.domainStrategy = enableIPv6 ? "UseIPv4v6" : "UseIPv4";
    }
    
    return outbound;
}

function buildXxrWarpOutbound (proxySettings, warpConfigs, endpoint, isChain, client) {
    const { 
        warpEnableIPv6,
		nikaNGNoiseMode,  
		noiseCountMin, 
		noiseCountMax, 
		noiseSizeMin, 
		noiseSizeMax, 
		noiseDelayMin, 
		noiseDelayMax 
	} = proxySettings;

    const {
        warpIPv6,
        reserved,
        publicKey,
        privateKey
    } = extractWireguardParams(warpConfigs, isChain);

    const outbound = {
        protocol: "wireguard",
        settings: {
            address: [
                "172.16.0.2/32",
                warpIPv6
            ],
            mtu: 1280,
            peers: [
                {
                    endpoint: endpoint,
                    publicKey: publicKey,
                    keepAlive: 5
                }
            ],
            reserved: base64ToDecimal(reserved),
            secretKey: privateKey
        },
        streamSettings: {
            sockopt: {
                dialerProxy: "proxy",
                domainStrategy: warpEnableIPv6 ? "UseIPv4v6" : "UseIPv4",
            }
        },
        tag: isChain ? "chain" : "proxy"
    };

    !isChain && delete outbound.streamSettings;
    client === 'nikang' && !isChain && Object.assign(outbound.settings, {
        wnoise: nikaNGNoiseMode,
        wnoisecount: noiseCountMin === noiseCountMax ? noiseCountMin : `${noiseCountMin}-${noiseCountMax}`,
        wpayloadsize: noiseSizeMin === noiseSizeMax ? noiseSizeMin : `${noiseSizeMin}-${noiseSizeMax}`,
        wnoisedelay: noiseDelayMin === noiseDelayMax ? noiseDelayMin : `${noiseDelayMin}-${noiseDelayMax}`
    });

    return outbound;
}

function buildXxrChainOutbound(chainProxyParams, enableIPv6) {
    if (['socks', 'http'].includes(chainProxyParams.protocol)) {
        const { protocol, server, port, user, pass } = chainProxyParams;
        return {
            protocol: protocol,
            settings: {
                servers: [
                    {
                        address: server,
                        port: +port,
                        users: [
                            {
                                user: user,
                                pass: pass,
                                level: 8
                            }
                        ]
                    }
                ]
            },
            streamSettings: {
                network: "tcp",
                sockopt: {
                    dialerProxy: "proxy",
                    domainStrategy: enableIPv6 ? "UseIPv4v6" : "UseIPv4",
                    tcpNoDelay: true
                }
            },
            mux: {
                enabled: true,
                concurrency: 8,
                xudpConcurrency: 16,
                xudpProxyUDP443: "reject"
            },
            tag: "chain"
        };
    }

    const { 
        server, 
        port, 
        uuid, 
        flow, 
        security, 
        type, 
        sni, 
        fp, 
        alpn, 
        pbk, 
        sid, 
        spx, 
        headerType, 
        host, 
        path, 
        authority, 
        serviceName, 
        mode 
    } = chainProxyParams;

    const proxyOutbound = {
        mux: {
            concurrency: 8,
            enabled: true,
            xudpConcurrency: 16,
            xudpProxyUDP443: "reject"
        },
        protocol: "vless",
        settings: {
            vnext: [
                {
                    address: server,
                    port: +port,
                    users: [
                        {
                            encryption: "none",
                            flow: flow,
                            id: uuid,
                            level: 8,
                            security: "auto"
                        }
                    ]
                }
            ]
        },
        streamSettings: {
            network: type,
            security: security,
            sockopt: {
                dialerProxy: "proxy",
                domainStrategy: enableIPv6 ? "UseIPv4v6" : "UseIPv4",
                tcpNoDelay: true
            }
        },
        tag: "chain"
    };
    
    if (security === 'tls') {
        const tlsAlpns = alpn ? alpn?.split(',') : [];
        proxyOutbound.streamSettings.tlsSettings = {
            allowInsecure: false,
            fingerprint: fp,
            alpn: tlsAlpns,
            serverName: sni
        };
    }

    if (security === 'reality') { 
        delete proxyOutbound.mux;
        proxyOutbound.streamSettings.realitySettings = {
            fingerprint: fp,
            publicKey: pbk,
            serverName: sni,
            shortId: sid,
            spiderX: spx
        };
    }

    if (headerType === 'http') {
        const httpPaths = path?.split(',');
        const httpHosts = host?.split(',');
        proxyOutbound.streamSettings.tcpSettings = {
            header: {
                request: {
                    headers: { Host: httpHosts },
                    method: "GET",
                    path: httpPaths,
                    version: "1.1"
                },
                response: {
                    headers: { "Content-Type": ["application/octet-stream"] },
                    reason: "OK",
                    status: "200",
                    version: "1.1"
                },
                type: "http"
            }
        };
    }

    if (type === 'tcp' && security !== 'reality' && !headerType) proxyOutbound.streamSettings.tcpSettings = {
        header: {
            type: "none"
        }
    };
    
    if (type === 'ws') proxyOutbound.streamSettings.wsSettings = {
        headers: { Host: host },
        path: path
    };
    
    if (type === 'grpc') {
        delete proxyOutbound.mux;
        proxyOutbound.streamSettings.grpcSettings = {
            authority: authority,
            multiMode: mode === 'multi',
            serviceName: serviceName
        };
    }
    
    return proxyOutbound;
}

function buildXxrConfig (proxySettings, remark, isFragment, isBalancer, isChain, balancerFallback, isWarp) {
    const { 
        vltFakeDNS, 
        enableIPv6, 
        warpFakeDNS,
        bestVTInterval, 
        bestWarpInterval, 
        lengthMin, 
        lengthMax, 
        intervalMin, 
        intervalMax, 
        fragmentPackets 
    } = proxySettings;

    const isFakeDNS = (vltFakeDNS && !isWarp) || (warpFakeDNS && isWarp);
    const config = structuredClone(xxrConfigTemp);
    config.remarks = remark;
    if (isFakeDNS) {
        config.inbounds[0].sniffing.destOverride.push("fakedns");
        config.inbounds[1].sniffing.destOverride.push("fakedns");
    }

    if (isFragment) {
        const fragment = config.outbounds[0].settings.fragment;
        fragment.length = `${lengthMin}-${lengthMax}`;
        fragment.interval = `${intervalMin}-${intervalMax}`;
        fragment.packets = fragmentPackets;
        config.outbounds[0].settings.domainStrategy = enableIPv6 ? "UseIPv4v6" : "UseIPv4";
    } else {
        config.outbounds.shift();
    }

    if (isBalancer) {
        const interval = isWarp ? bestWarpInterval : bestVTInterval;
        config.observatory.probeInterval = `${interval}s`;
        if (balancerFallback) config.routing.balancers[0].fallbackTag = "prox-2";
        if (isChain) {
            config.observatory.subjectSelector.push("chain");
            const chainBalancer = structuredClone(config.routing.balancers[0]);
            if (balancerFallback) chainBalancer.fallbackTag = "chain-2";
            config.routing.balancers.push({...chainBalancer, selector: ["chain"]});
            config.routing.balancers[0].tag = "all-proxy";
        }
    } else {
        delete config.observatory;
        delete config.routing.balancers;
    }

    return config;
}

async function buildXxrBestPingConfig(proxySettings, totalAddresses, chainProxy, outbounds, isFragment) {
    const remark = isFragment ? '💦 BPB F - Best Ping 💥' : '💦 BPB - Best Ping 💥';
    const config = buildXxrConfig(proxySettings, remark, isFragment, true, chainProxy, true);
    config.dns = await buildXxrDNS(proxySettings, totalAddresses, undefined, false, false);
    config.routing.rules = buildXxrRoutingRules(proxySettings, totalAddresses, chainProxy, true, false, false);
    config.outbounds.unshift(...outbounds);

    return config;
}

async function buildXxrBestFragmentConfig(proxySettings, hostName, chainProxy, outbounds) {
    const bestFragValues = ['10-20', '20-30', '30-40', '40-50', '50-60', '60-70', 
                            '70-80', '80-90', '90-100', '10-30', '20-40', '30-50', 
                            '40-60', '50-70', '60-80', '70-90', '80-100', '100-200'];

    const config = buildXxrConfig(proxySettings, '💦 BPB F - Best Fragment 😎', true, true, chainProxy, false, false);
    config.dns = await buildXxrDNS(proxySettings, [], hostName, false, false);
    config.routing.rules = buildXxrRoutingRules(proxySettings, [], chainProxy, true, false, false);
    const fragment = config.outbounds.shift();
    const bestFragOutbounds = [];
    
    bestFragValues.forEach( (fragLength, index) => { 
        if (chainProxy) {
            const chainOutbound = structuredClone(chainProxy);
            chainOutbound.tag = `chain-${index + 1}`;
            chainOutbound.streamSettings.sockopt.dialerProxy = `prox-${index + 1}`;
            bestFragOutbounds.push(chainOutbound);
        }
        
        const proxyOutbound = structuredClone(outbounds[chainProxy ? 1 : 0]);
        proxyOutbound.tag = `prox-${index + 1}`;
        proxyOutbound.streamSettings.sockopt.dialerProxy = `frag-${index + 1}`;
        const fragmentOutbound = structuredClone(fragment);
        fragmentOutbound.tag = `frag-${index + 1}`;
        fragmentOutbound.settings.fragment.length = fragLength;
        fragmentOutbound.settings.fragment.interval = '1-1';
        bestFragOutbounds.push(proxyOutbound, fragmentOutbound);
    });
    
    config.outbounds.unshift(...bestFragOutbounds);
    return config;
}

async function buildXxrWorkerLessConfig(proxySettings) {
    const config = buildXxrConfig(proxySettings, '💦 BPB F - WorkerLess ⭐', true, false, false, false, false);
    config.dns = await buildXxrDNS(proxySettings, [], undefined, true);
    config.routing.rules = buildXxrRoutingRules(proxySettings, [], false, false, true, false);
    const fakeOutbound = buildXxrXLOutbound('fake-outbound', 'google.com', '443', globalThis.userID, 'google.com', 'google.com', '', true, false);
    delete fakeOutbound.streamSettings.sockopt;
    fakeOutbound.streamSettings.wsSettings.path = '/';
    config.outbounds.push(fakeOutbound);
    return config;
}

export async function getXxrCustomConfigs(request, env, isFragment) {
    const { proxySettings } = await getDataset(request, env);
    let configs = [];
    let outbounds = [];
    let protocols = [];
    let chainProxy;
    const {
        proxyIP,
        outProxy,
        outProxyParams,
        cleanIPs,
        enableIPv6,
        customCdnAddrs,
        customCdnHost,
        customCdnSni,
        vConfigs,
        ttjConfigs,
        ports
    } = proxySettings;

    if (outProxy) {
        const proxyParams = JSON.parse(outProxyParams);
        try {
            chainProxy = buildXxrChainOutbound(proxyParams, enableIPv6);
        } catch (error) {
            console.log('An error occured while parsing chain proxy: ', error);
            chainProxy = undefined;
            await env.cnc.put("proxySettings", JSON.stringify({
                ...proxySettings, 
                outProxy: '',
                outProxyParams: {}
            }));
        }
    }
    
    const Addresses = await getConfigAddresses(cleanIPs, enableIPv6);
    const customCdnAddresses = customCdnAddrs ? customCdnAddrs.split(',') : [];
    const totalAddresses = isFragment ? [...Addresses] : [...Addresses, ...customCdnAddresses];
    const totalPorts = ports.filter(port => isFragment ? globalThis.defaultHttpsPorts.includes(port): true);
    vConfigs && protocols.push('VLESS');
    ttjConfigs && protocols.push('Trojan');
    let proxyIndex = 1;
    
    for (const protocol of protocols) {
        let protocolIndex = 1;
        for (const port of totalPorts)  {
            for (const addr of totalAddresses) {
                const isCustomAddr = customCdnAddresses.includes(addr);
                const configType = isCustomAddr ? 'C' : isFragment ? 'F' : '';
                const sni = isCustomAddr ? customCdnSni : randomUpperCase(globalThis.hostName);
                const host = isCustomAddr ? customCdnHost : globalThis.hostName;
                const remark = generateRemark(protocolIndex, port, addr, cleanIPs, protocol, configType);
                const customConfig = buildXxrConfig(proxySettings, remark, isFragment, false, chainProxy, false, false);
                customConfig.dns = await buildXxrDNS(proxySettings, [addr], undefined);
                customConfig.routing.rules = buildXxrRoutingRules(proxySettings, [addr], chainProxy, false, false, false);
                const outbound = protocol === 'VLESS'
                    ? buildXxrXLOutbound('proxy', addr, port, host, sni, proxyIP, isFragment, isCustomAddr, enableIPv6)
                    : buildXxrTOutbound('proxy', addr, port, host, sni, proxyIP, isFragment, isCustomAddr, enableIPv6);

                customConfig.outbounds.unshift({...outbound});
                outbound.tag = `prox-${proxyIndex}`;

                if (chainProxy) {
                    customConfig.outbounds.unshift(chainProxy);
                    const chainOutbound = structuredClone(chainProxy);
                    chainOutbound.tag = `chain-${proxyIndex}`;
                    chainOutbound.streamSettings.sockopt.dialerProxy = `prox-${proxyIndex}`;
                    outbounds.push(chainOutbound);
                }
                
                outbounds.push(outbound);
                configs.push(customConfig);
                proxyIndex++;
                protocolIndex++;
            }
        }
    }
    
    const bestPing = await buildXxrBestPingConfig(proxySettings, totalAddresses, chainProxy, outbounds, isFragment);
    const finalConfigs = [...configs, bestPing];
    if (isFragment) {
        const bestFragment = await buildXxrBestFragmentConfig(proxySettings, globalThis.hostName, chainProxy, outbounds);
        const workerLessConfig = await buildXxrWorkerLessConfig(proxySettings); 
        finalConfigs.push(bestFragment, workerLessConfig);
    }
    return new Response(JSON.stringify(finalConfigs, null, 4), { 
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'CDN-Cache-Control': 'no-store'
        }
    });
}

export async function getXxrWarpConfigs (request, env, client) {
    const { proxySettings, warpConfigs } = await getDataset(request, env);
    const xxrWarpConfigs = [];
    const xxrWoWConfigs = [];
    const xxrWarpOutbounds = [];
    const xxrWoWOutbounds = [];
    const { warpEndpoints } = proxySettings;
    const outboundDomains = warpEndpoints.split(',').map(endpoint => endpoint.split(':')[0]).filter(address => isDomain(address));
    const proIndicator = client === 'nikang' ? ' Pro ' : ' ';
    
    for (const [index, endpoint] of warpEndpoints.split(',').entries()) {
        const endpointHost = endpoint.split(':')[0];
        const warpConfig = buildXxrConfig(proxySettings, `💦 ${index + 1} - Warp${proIndicator}🇮🇷`, false, false, false, false, true);
        const WoWConfig = buildXxrConfig(proxySettings, `💦 ${index + 1} - WoW${proIndicator}🌍`, false, false, true, false, true);
        warpConfig.dns = WoWConfig.dns = await buildXxrDNS(proxySettings, [endpointHost], undefined, false, true);    
        warpConfig.routing.rules = buildXxrRoutingRules(proxySettings, [endpointHost], false, false, false, true);
        WoWConfig.routing.rules = buildXxrRoutingRules(proxySettings, [endpointHost], true, false, false, true);
        const warpOutbound = buildXxrWarpOutbound(proxySettings, warpConfigs, endpoint, false, client);
        const WoWOutbound = buildXxrWarpOutbound(proxySettings, warpConfigs, endpoint, true, client);
        warpConfig.outbounds.unshift(warpOutbound);
        WoWConfig.outbounds.unshift(WoWOutbound, warpOutbound);
        xxrWarpConfigs.push(warpConfig);
        xxrWoWConfigs.push(WoWConfig);
        const proxyOutbound = structuredClone(warpOutbound);
        proxyOutbound.tag = `prox-${index + 1}`;
        const chainOutbound = structuredClone(WoWOutbound);
        chainOutbound.tag = `chain-${index + 1}`;
        chainOutbound.streamSettings.sockopt.dialerProxy = `prox-${index + 1}`;
        xxrWarpOutbounds.push(proxyOutbound);
        xxrWoWOutbounds.push(chainOutbound);
    }

    const dnsObject = await buildXxrDNS(proxySettings, outboundDomains, undefined, false, true);
    const xxrWarpBestPing = buildXxrConfig(proxySettings, `💦 Warp${proIndicator}- Best Ping 🚀`, false, true, false, false, true);
    xxrWarpBestPing.dns = dnsObject;    
    xxrWarpBestPing.routing.rules = buildXxrRoutingRules(proxySettings, outboundDomains, false, true, false, true);
    xxrWarpBestPing.outbounds.unshift(...xxrWarpOutbounds);
    const xxrWoWBestPing = buildXxrConfig(proxySettings, `💦 WoW${proIndicator}- Best Ping 🚀`, false, true, true, false, true);
    xxrWoWBestPing.dns = dnsObject;
    xxrWoWBestPing.routing.rules = buildXxrRoutingRules(proxySettings, outboundDomains, true, true, false, true);
    xxrWoWBestPing.outbounds.unshift(...xxrWoWOutbounds, ...xxrWarpOutbounds);
    const configs = [...xxrWarpConfigs, ...xxrWoWConfigs, xxrWarpBestPing, xxrWoWBestPing];
    return new Response(JSON.stringify(configs, null, 4), { 
        status: 200,
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'CDN-Cache-Control': 'no-store'
        }
    });
}

const xxrConfigTemp = {
    remarks: "",
    log: {
        loglevel: "warning",
    },
    dns: {},
    inbounds: [
        {
            port: 10808,
            protocol: "socks",
            settings: {
                auth: "noauth",
                udp: true,
                userLevel: 8,
            },
            sniffing: {
                destOverride: ["http", "tls"],
                enabled: true,
                routeOnly: true
            },
            tag: "socks-in",
        },
        {
            port: 10809,
            protocol: "http",
            settings: {
                auth: "noauth",
                udp: true,
                userLevel: 8,
            },
            sniffing: {
                destOverride: ["http", "tls"],
                enabled: true,
                routeOnly: true
            },
            tag: "http-in",
        },
        {
            listen: "127.0.0.1",
            port: 10853,
            protocol: "dokodemo-door",
            settings: {
              address: "1.1.1.1",
              network: "tcp,udp",
              port: 53
            },
            tag: "dns-in"
        }
    ],
    outbounds: [
        {
            tag: "fragment",
            protocol: "freedom",
            settings: {
                fragment: {
                    packets: "tlshello",
                    length: "",
                    interval: "",
                },
                domainStrategy: "UseIP"
            },
            streamSettings: {
                sockopt: {
                    tcpKeepAliveIdle: 30,
                    tcpNoDelay: true
                },
            },
        },
        {
            protocol: "dns",
            tag: "dns-out"
        },
        {
            protocol: "freedom",
            settings: {},
            tag: "direct",
        },
        {
            protocol: "blackhole",
            settings: {
                response: {
                    type: "http",
                },
            },
            tag: "block",
        },
    ],
    policy: {
        levels: {
            8: {
                connIdle: 300,
                downlinkOnly: 1,
                handshake: 4,
                uplinkOnly: 1,
            }
        },
        system: {
            statsOutboundUplink: true,
            statsOutboundDownlink: true,
        }
    },
    routing: {
        domainStrategy: "IPIfNonMatch",
        rules: [],
        balancers: [
            {
                tag: "all",
                selector: ["prox"],
                strategy: {
                    type: "leastPing",
                },
            }
        ]
    },
    observatory: {
        probeInterval: "30s",
        probeURL: "https://www.gstatic.com/generate_204",
        subjectSelector: ["prox"],
        EnableConcurrency: true,
    },
    stats: {}
};