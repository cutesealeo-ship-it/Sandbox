import os
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()

client = Anthropic(
    base_url=os.getenv("ANTHROPIC_BASE_URL"),
    api_key=os.getenv("ANTHROPIC_API_KEY")
)

def ask_ai(prompt, max_tokens=2048):
    """Call Claude Haiku API with the given prompt"""
    res = client.messages.create(
        model="claude-haiku",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}]
    )
    return res.content[0].text