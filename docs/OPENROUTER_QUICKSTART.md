# OpenRouter Quick Reference

## 🚀 Quick Start

### Bills
```bash
npm run gen-sum-or <model> <billType> <billNumber>
```

### Executive Orders
```bash
npm run gen-sum-or-eo <model> <orderNumber>
```

## 📋 Available Models

| Command    | Model             | Params            | Context | Best For                       |
| ---------- | ----------------- | ----------------- | ------- | ------------------------------ |
| `deepseek` | DeepSeek V3.1     | 671B (37B active) | 163K    | **Recommended** - Best quality |
| `qwen`     | Qwen3 235B A22B   | 235B (22B active) | 131K    | Alternative, strong reasoning  |
| `gemini`   | Gemini 2.0 Flash  | Proprietary       | **1M**  | Very long bills (100+ pages)   |
| `mistral`  | Mistral Small 3.2 | 24B               | 131K    | Fastest, high volume           |

## 💡 Examples

### Bills
```bash
# Recommended: DeepSeek V3.1
npm run gen-sum-or deepseek HR 4398
npm run gen-sum-or deepseek S 2309

# Long bill: Gemini (1M context)
npm run gen-sum-or gemini HR 5371

# Fast processing: Mistral
npm run gen-sum-or mistral HRES 723

# Alternative: Qwen
npm run gen-sum-or qwen S 2309
```

### Executive Orders
```bash
# Recommended: DeepSeek V3.1
npm run gen-sum-or-eo deepseek 14067
npm run gen-sum-or-eo deepseek 14111

# Long order: Gemini (1M context)
npm run gen-sum-or-eo gemini 14175

# Fast processing: Mistral
npm run gen-sum-or-eo mistral 14177

# Alternative: Qwen
npm run gen-sum-or-eo qwen 14067
```

## 🎯 When to Use Which Model

**DeepSeek V3.1** (`deepseek`)

- ✅ Default choice for most bills
- ✅ Best quality-to-cost ratio
- ✅ Strong reasoning capabilities
- ✅ Hybrid thinking/non-thinking modes

**Qwen3 235B** (`qwen`)

- ✅ When DeepSeek hits rate limits
- ✅ Complex reasoning tasks
- ✅ Multilingual bills
- ✅ Alternative to DeepSeek

**Gemini 2.0 Flash** (`gemini`)

- ✅ Bills over 100 pages
- ✅ Bills with tables/charts
- ✅ Need entire bill in context
- ✅ Fastest time-to-first-token

**Mistral Small 3.2** (`mistral`)

- ✅ High-volume batch processing
- ✅ When speed is critical
- ✅ Simple bills
- ✅ Resource-constrained environments

## 📊 Comparison Table

| Feature       | DeepSeek   | Qwen        | Gemini     | Mistral     |
| ------------- | ---------- | ----------- | ---------- | ----------- |
| **Cost**      | FREE       | FREE        | FREE       | FREE        |
| **Quality**   | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐  | ⭐⭐⭐⭐   | ⭐⭐⭐⭐    |
| **Speed**     | ⭐⭐⭐⭐   | ⭐⭐⭐      | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐  |
| **Context**   | 163K       | 131K        | **1M**     | 131K        |
| **Reasoning** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐  | ⭐⭐⭐⭐   | ⭐⭐⭐⭐    |
| **Use Case**  | General    | Alternative | Long bills | High volume |

## 🔧 Setup

1. Get API key from [OpenRouter](https://openrouter.ai/)
2. Add to `.env`:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   ```
3. **For Executive Orders**: Ensure you've fetched EOs first:
   ```bash
   npm run fetch-executive-orders
   npm run update-eo-full-text
   ```
4. Run commands above

## 📖 Full Documentation

See [OPENROUTER_INTEGRATION.md](./OPENROUTER_INTEGRATION.md) for:

- Detailed model comparisons
- Performance benchmarks
- Code architecture
- Advanced usage patterns
- Troubleshooting guide

## 🆚 vs Existing Models

| Provider       | Model             | Cost          | Context | When to Use            |
| -------------- | ----------------- | ------------- | ------- | ---------------------- |
| **OpenRouter** | DeepSeek V3.1     | **FREE**      | 163K    | Default choice         |
| OpenAI         | GPT-5-nano        | $0.0003-0.001 | 128K    | Production (paid)      |
| Anthropic      | Claude Sonnet 4.5 | $0.008-0.024  | 200K    | Highest quality (paid) |
| **OpenRouter** | Gemini 2.0 Flash  | **FREE**      | **1M**  | Long bills             |

## ⚡ Tips

1. **Start with DeepSeek** - Best overall quality
2. **Use Gemini for long bills** - 1M context handles anything
3. **Mistral for batch** - Fastest for many bills
4. **Compare outputs** - Test multiple models on same bill
5. **Check rate limits** - Switch models if hitting limits

## 🐛 Troubleshooting

**Error: OPENROUTER_API_KEY not set**

```bash
# Add to .env
OPENROUTER_API_KEY=sk-or-v1-...
```

**Error: Invalid model**

```bash
# Valid models: deepseek, qwen, gemini, mistral
npm run gen-sum-or deepseek HR 4398  # ✅
npm run gen-sum-or invalid HR 4398   # ❌
```

**Rate Limits**

```bash
# Switch to different model
npm run gen-sum-or qwen HR 4398      # If deepseek limited
npm run gen-sum-or mistral HR 4398   # Try faster model
```

## 📞 Support

- Full docs: `docs/OPENROUTER_INTEGRATION.md`
- Script docs: `scripts/README.md`
- Issues: GitHub repository

---

**Last Updated:** October 2, 2025
