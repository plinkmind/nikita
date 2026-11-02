# LOCAL TEST STAND-IN for the free Hugging Face Space "yisol/IDM-VTON" (Gradio 4.24.0).
# Same components, same order and same api_name ("tryon") as the Space's app.py, so the website's real client code can be
# tested without internet. It does NOT do any AI: it returns the person photo stamped "LOCAL STAND-IN - NOT AI" and writes
# what it received to received.json. usage: python idm_vton_standin.py [port]
import json, sys, os
import gradio as gr
import gradio.networking as _n; _n.url_ok = lambda *a, **k: True  # sandbox: skip the "is localhost reachable" self-check
from PIL import ImageDraw

OUT = os.path.join(os.path.dirname(__file__), 'received.json')

def start_tryon(dict, garm_img, garment_des, is_checked, is_checked_crop, denoise_steps, seed):
    human = dict['background'].convert('RGB')
    json.dump({'human_size': human.size, 'garm_size': garm_img.size, 'garment_des': garment_des, 'is_checked': is_checked,
               'is_checked_crop': is_checked_crop, 'denoise_steps': denoise_steps, 'seed': seed, 'layers': len(dict.get('layers') or [])}, open(OUT, 'w'))
    out = human.copy(); d = ImageDraw.Draw(out); w, h = out.size
    d.rectangle([0, h // 2 - 40, w, h // 2 + 40], fill=(194, 26, 75)); d.text((20, h // 2 - 10), 'LOCAL STAND-IN - NOT AI', fill=(255, 255, 255))
    g = garm_img.convert('RGB'); g.thumbnail((w // 3, h // 3)); out.paste(g, (w - g.width - 10, 10))
    return out, human

with gr.Blocks() as demo:
    with gr.Row():
        imgs = gr.ImageEditor(sources='upload', type="pil", label='Human')
        garm_img = gr.Image(label="Garment", sources='upload', type="pil")
        prompt = gr.Textbox(placeholder="Description of garment")
    is_checked = gr.Checkbox(label="Yes", info="Use auto-generated mask", value=True)
    is_checked_crop = gr.Checkbox(label="Yes", info="Use auto-crop & resizing", value=False)
    image_out = gr.Image(label="Output"); masked_img = gr.Image(label="Masked image output")
    try_button = gr.Button(value="Try-on")
    denoise_steps = gr.Number(label="Denoising Steps", minimum=20, maximum=40, value=30, step=1)
    seed = gr.Number(label="Seed", minimum=-1, maximum=2147483647, step=1, value=42)
    try_button.click(fn=start_tryon, inputs=[imgs, garm_img, prompt, is_checked, is_checked_crop, denoise_steps, seed], outputs=[image_out, masked_img], api_name='tryon')

# Hugging Face serves Spaces behind its own proxy, which answers cross-origin requests from other websites (with cookies
# allowed). Gradio's built-in CORS does not allow cookies, so the website's client could not talk to a plain local Gradio.
# This small wrapper adds the same kind of headers so the browser test exercises the real client code path.
import uvicorn
from fastapi import FastAPI
class HFLikeCORS:
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http': return await self.app(scope, receive, send)
        origin = dict(scope['headers']).get(b'origin')
        cors = [(b'access-control-allow-origin', origin), (b'access-control-allow-credentials', b'true'), (b'vary', b'origin')] if origin else []
        if scope['method'] == 'OPTIONS' and origin:
            hdrs = cors + [(b'access-control-allow-methods', b'GET, POST, OPTIONS'), (b'access-control-allow-headers', dict(scope['headers']).get(b'access-control-request-headers', b'*'))]
            await send({'type': 'http.response.start', 'status': 200, 'headers': hdrs}); return await send({'type': 'http.response.body', 'body': b''})
        async def send2(msg):
            if msg['type'] == 'http.response.start':
                msg['headers'] = [h for h in msg.get('headers', []) if not h[0].lower().startswith(b'access-control-allow-')] + cors
            await send(msg)
        return await self.app(scope, receive, send2)
demo.queue(max_size=10)
app = gr.mount_gradio_app(FastAPI(), demo, path='')
uvicorn.run(HFLikeCORS(app), host='127.0.0.1', port=int(sys.argv[1]) if len(sys.argv) > 1 else 7861, log_level='warning')
