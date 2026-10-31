// Product catalogue. This is the ONLY place that decides which products appear and how they are grouped.
// To add a product later: add it to MAKEUP (makeup.js) or JEWELLERY (jewellery.js) with its drawing code, then (optionally) list it in a group below.
// Optional fields on any product: image: '/images/my-product.jpg' (shown instead of the generated icon), link: 'https://...' (future "buy" link).
// All current entries are DEMONSTRATION entries: no real brands, prices or stock.
import { MAKEUP } from './makeup.js'
import { JEWELLERY } from './jewellery.js'

export const CATEGORIES = {
  makeup: { label: 'Makeup', products: MAKEUP, groups: [{ name: 'Makeup products', ids: MAKEUP.map((p) => p.id) }] },
  jewellery: {
    label: 'Jewellery', products: JEWELLERY,
    groups: [
      { name: 'Earrings', ids: ['studs', 'earrings', 'hoops', 'jhumkas'] },
      { name: 'Necklaces', ids: ['necklace', 'chain', 'pendant'] },
      { name: 'Nose rings', ids: ['nosering', 'nosepin'] },
      { name: 'Head jewellery', ids: ['tiara'] },
    ],
  },
}
export const ALL_PRODUCTS = Object.values(CATEGORIES).flatMap((c) => c.products)
export const findProduct = (id) => ALL_PRODUCTS.find((p) => p.id === id)
export const categoryOf = (id) => Object.keys(CATEGORIES).find((k) => CATEGORIES[k].products.some((p) => p.id === id))
export const groupsOf = (cat) => CATEGORIES[cat].groups.map((g) => ({ name: g.name, items: g.ids.map(findProduct).filter(Boolean) })).filter((g) => g.items.length)
// small generated icon (a colour dot in the first shade) used when a product has no image of its own
export const iconOf = (p) => p.image ? `<img class="pi" src="${p.image}" alt="" loading="lazy">` : `<i class="pi" style="background:${p.shades[0].c}"></i>`
