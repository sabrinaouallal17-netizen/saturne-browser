// Saturne — built-in ad blocker
// Blocks requests to known ad & tracking servers, and hides common ad slots left empty on pages.
// The list is built in (nothing is downloaded). YouTube is left alone.
const AD_DOMAINS = `
doubleclick.net googlesyndication.com googleadservices.com adservice.google.com googletagservices.com
pagead2.googlesyndication.com tpc.googlesyndication.com securepubads.g.doubleclick.net imasdk.googleapis.com
adnxs.com adsrvr.org amazon-adsystem.com aax.amazon-adsystem.com criteo.com criteo.net taboola.com outbrain.com
pubmatic.com rubiconproject.com openx.net casalemedia.com indexww.com smartadserver.com moatads.com
adform.net yieldmo.com teads.tv sharethrough.com 33across.com media.net bidswitch.net lijit.com sovrn.com
adsafeprotected.com doubleverify.com zedo.com popads.net popcash.net propellerads.com exoclick.com juicyads.com
adcash.com adsterra.com hilltopads.net trafficjunky.net trafficstars.com revcontent.com mgid.com
contextweb.com gumgum.com triplelift.com 3lift.com districtm.io emxdgt.com sonobi.com spotxchange.com spotx.tv
springserve.com undertone.com yieldlab.net adition.com adkernel.com adtech.de advertising.com adroll.com
adsymptotic.com bidr.io quantcount.com quantserve.com scorecardresearch.com serving-sys.com mathtag.com
rlcdn.com demdex.net everesttech.net agkn.com bluekai.com krxd.net exelator.com eyeota.net crwdcntrl.net
adgrx.com adhigh.net adlightning.com admixer.net adocean.pl adotmob.com adsco.re adskeeper.co.uk adspirit.de
adtelligent.com advangelists.com yieldoptimizer.com zemanta.com nativo.com connatix.com primis.tech
vidoomy.com seedtag.com ogury.com smaato.net inmobi.com applovin.com unityads.unity3d.com
ads-twitter.com static.ads-twitter.com analytics.twitter.com ads.linkedin.com px.ads.linkedin.com
bat.bing.com ads.yahoo.com analytics.yahoo.com adtechus.com yieldmanager.com
google-analytics.com ssl.google-analytics.com stats.g.doubleclick.net hotjar.com static.hotjar.com
mouseflow.com fullstory.com luckyorange.com crazyegg.com clicktale.net mixpanel.com segment.io
newrelic.com nr-data.net chartbeat.com chartbeat.net parsely.com omtrdc.net 2o7.net
adzerk.net carbonads.com buysellads.com servedby-buysellads.com tradedoubler.com awin1.com
zergnet.com infolinks.com kontera.com adblade.com content.ad bidvertiser.com clickadu.com
popmyads.com onclickads.net onclkds.com adxpremium.com a-ads.com coinzilla.io
`.split(/\s+/).filter(Boolean);
const BLOCKED = new Set(AD_DOMAINS);

// never blocked: pages where it would break things, or that the user asked about
const SKIP_SITES = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com'];

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const matches = (host, list) => {
  for (let h = host; h; ) {
    if (list.has ? list.has(h) : list.includes(h)) return true;
    const i = h.indexOf('.');
    if (i < 0) return false;
    h = h.slice(i + 1);
  }
  return false;
};

// empty ad slots that stay on the page once their content is blocked
const COSMETIC = `
ins.adsbygoogle, .adsbygoogle, [id^="google_ads_iframe"], [id^="div-gpt-ad"], [id^="gpt-ad-"], [data-google-query-id],
[data-ad-slot], [data-adunit], [data-ad-unit], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"],
iframe[id^="google_ads_"], [id^="taboola-"], .trc_related_container, .OUTBRAIN, .ob-widget, [data-widget-id^="outbrain"],
amp-ad, amp-embed[type="taboola"], .mgid-widget, [id^="mgid_"], .adthrive-ad, .ezoic-ad, [id^="ezoic-pub-ad"],
[aria-label="Advertisement"], [aria-label="advertisement"], .ad-slot, .ad-unit, .adunit, .advertisement-container
{ display: none !important; }`;

module.exports = { BLOCKED, SKIP_SITES, COSMETIC, hostOf, matches };
