# Before switching mainlineautoworks.com to this site

Saved Nov 10, 2026. Done items are checked.

## Square and forms
- [x] Tint page: Square booking calendar added; each package's "Book now" opens its own Square service
      (the old site's Full Windshield button opened the $65 Sun Banner booking; fixed here)
- [x] Detailing: "open it straight in Square" link follows the package the customer built
- [x] Estimate forms on Home, Tint, PPF & Ceramic, Calipers and Wraps, sent to info@ with photos (needs the Apps Script update below)
- [x] Apps Script updated (version 2) with estimate forms + Square booking
- [x] One-step detailing booking: Square connected; website shows open times and books package + size + add-ons in Square
- [ ] Squarespace store product pages (/auto-detailing/p/..., /tint-2-go/p/...): point to Square booking or drop
- [ ] Second Square site (direct-detailing-services.square.site): keep or drop
- [ ] Google Forms: corporate event registration and office park detailing: keep or rebuild
- [ ] Newsletter signup ("join our mailing list"): replace or drop

## Pages on the old site with no equivalent yet
- [ ] About
- [ ] PDR (paintless dent repair), wheel repair, windshield repair/replacement, air filter replacement
- [ ] Office park detailing, corporate event registration, member pages
- [ ] Portfolio galleries (Lamborghini, Maserati, Camaro/Krando, Delaware Valley Paving)
- [ ] Tint 2 Go

## Switch-over
- [x] Redirects from every old address to its new page (e.g. /ceramic-coatings, /window-tinting-west-chester-pa, /make-an-appointment)
- [x] Google Analytics G-927PVGSFBV and Tag Manager GTM-P46Q6HCC
- [x] sitemap.xml and robots.txt
- [x] CNAME file (DNS: Namecheap A records -> GitHub, www -> mainlineautoworks.github.io; MX/TXT untouched)
- [ ] `SITE` in Code.gs → https://mainlineautoworks.com/track/
- [ ] Google Business Profile website link; Search Console resubmit sitemap
- [ ] Confirm caliper page claims and photo rights

## After the switch
- [ ] Enforce HTTPS in GitHub Settings > Pages once the certificate is issued
- [ ] Search Console: submit https://mainlineautoworks.com/sitemap.xml
- [ ] Cancel the Squarespace website plan after 1-2 weeks (domain stays at Namecheap)
- [ ] Old pages currently redirected to the estimate form or homepage: PDR, wheel repair, windshield, air filter, About, portfolios, corporate events
