// FREE outfit try-on: the public IDM-VTON research demo on Hugging Face (https://huggingface.co/spaces/yisol/IDM-VTON).
//
// Why the generation runs in the VISITOR'S BROWSER and not on this server:
//  - Hugging Face's free GPU time (ZeroGPU) is counted per visitor. Called from the browser, every visitor gets their own free
//    allowance. Called from this server, ALL visitors would share one small allowance (a few images a day for the whole site).
//  - A generation often waits 30 s to several minutes in Hugging Face's queue: longer than a Netlify Function may run (60 s).
// So for this provider the backend creates the job, the browser runs the model with Hugging Face's official client and sends the
// finished image back (POST /api/tryon/:id/complete). The backend checks it really is an image and stores it privately.
// Limits: shared free queue, small daily quota per visitor, upper-body garments work best, licence CC BY-NC-SA 4.0 (NON-commercial).
export const freeIdmVton = {
  id: 'idm-vton-free', label: 'IDM-VTON (free demo on Hugging Face)', type: 'outfit', mode: 'browser', paid: false,
  licence: 'CC BY-NC-SA 4.0 (non-commercial research licence)',
  available: (cfg) => cfg.providers.freeEnabled,
}
