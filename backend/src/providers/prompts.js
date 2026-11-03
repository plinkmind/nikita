// Hairstyle menu (based on the reference sheets supplied by the site owner) and the instruction sent to the image editor.
// The prompt is built ONLY from these fixed texts on the server: the browser sends an id, so nobody can inject instructions.
export const STYLES = {
  'h-bob': 'a softly sculpted chin-length bob with smooth, gently rounded ends',
  'h-lob-waves': 'a blunt shoulder-length lob with soft loose waves',
  'h-fringe-lob': 'a shoulder-length lob with a full, soft straight fringe (bangs)',
  'h-curtain': 'medium-length layered hair with curtain bangs framing the face',
  'h-shag': 'a modern shag haircut with airy, feathered layers and soft volume',
  'h-shag-bangs': 'a textured shag haircut with wispy bangs',
  'h-curls': 'shoulder-grazing defined curls',
  'h-deep-curly': 'long voluminous deep curls with a side part',
  'h-mermaid': 'long textured mermaid waves past the shoulders',
  'h-sideswept': 'long side-swept hair with a deep side part',
  'h-long': 'long straight sleek hair past the shoulders',
  'h-half-up': 'a half-up hairstyle with a twisted crown and loose lengths',
  'h-ponytail': 'a sleek high ponytail',
  'h-bun': 'a soft messy bun with a few face-framing strands',
  'h-short': 'a short textured pixie cut',
}
export const COLOURS = { black: 'black', 'dark-brown': 'dark brown', chestnut: 'chestnut brown', auburn: 'auburn', blonde: 'honey blonde', platinum: 'platinum blonde', burgundy: 'burgundy', copper: 'copper', ash: 'ash grey', rose: 'rose pink', natural: '' }

export const hairPrompt = (style, colour) =>
  `Edit this photo: change ONLY the person's hairstyle to ${style}${colour ? `, in ${colour} colour` : ', keeping their natural hair colour'}. ` +
  'This is the same person: keep the face, facial features, identity, skin tone and texture, expression, makeup, earrings, clothing, pose, camera angle, background and lighting exactly the same. ' +
  'The new hair must look like real photographed hair: a natural hairline and parting, individual strands and flyaways, realistic volume, and shadows and highlights that match the light in the photo. Hair that is now shorter must reveal the neck, shoulders and background naturally. Do not add text, borders or anything else.'
