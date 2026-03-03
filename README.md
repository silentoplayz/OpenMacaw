# 🦜 OpenMacaw

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Website](https://img.shields.io/badge/Website-openmacaw.com-green)](https://openmacaw.com)
[![Status](https://img.shields.io/badge/Status-Architecting-orange)](#)

**The Universal, Security-First AI Guardian Agent.**

OpenMacaw is a world-changing open-source mission to bring a truly safe, performant, and cross-platform AI workflow automation agent to developers and power users. We are building the "digital ghost in the machine"—reimagining the agentic workflow movement with a relentless focus on precision and safety.

## ⚠️ The Problem: The "Black-Box" Way
The current landscape of AI desktop agents is fundamentally flawed. They execute actions autonomously in a "black-box" manner without giving you the chance to review their plans. They hallucinate non-existent UI elements, waste tokens in infinite retry loops, and gamble with your local system state by taking actions without your knowledge.

For professionals who demand precision, security, and auditable actions, these solutions are undeniably dangerous. We refuse to accept this compromise.

## 🛡️ The Macaw Way: The Guardian Agent
OpenMacaw represents a paradigm shift. We are harnessing the speed and safety of **Rust** to build a secure, native core that can execute local intelligence on any operating system, reliably and at blazing speeds.

- **Zero Overhead:** OpenMacaw's Rust core runs as a lightweight, lightning-fast daemon across Windows, macOS, and Linux.
- **Privacy as a Default:** Inference happens strictly on-device. No cloud dependencies. No telemetry. Your data stays on your machine.
- **Human-in-the-Loop:** Every critical action requires your final approval. OpenMacaw pauses execution on state-modifying tasks until you verify the parameters.

## 🧠 The Planner-Executor Engine
At the core of OpenMacaw lies its dual-phase architecture. Rather than relying on fragile, monolithic models to both think and act simultaneously, we separate intent from action:

1. **The Planner:** Given your goal, it generates a comprehensive, multi-step execution graph and dependency map.
2. **The Executor:** It strictly follows the approved graph, executing one node at a time with strict verification checks.

This architecture drastically reduces hallucinations and ensures the planned workflow aligns exactly with your goal before a single destructive action is taken.

## 🐳 Docker Deployment

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) (v20+) and [Docker Compose](https://docs.docker.com/compose/install/) installed.

### Quick Start (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/OpenMacaw/OpenMacaw.git
   cd OpenMacaw
   ```

2. **Configure environment variables:**

   Create a `.env` file in the project root (all values are optional — see the table below):

   ```env
   AUTH_TOKEN=your_secret_token
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   OLLAMA_BASE_URL=http://localhost:11434
   DEFAULT_MODEL=claude-3-5-sonnet-20241022
   DEFAULT_PROVIDER=anthropic
   ```

   | Variable | Default | Description |
   |---|---|---|
   | `AUTH_TOKEN` | *(none)* | Optional token to protect the API |
   | `ANTHROPIC_API_KEY` | *(none)* | Anthropic API key |
   | `OPENAI_API_KEY` | *(none)* | OpenAI API key |
   | `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
   | `DEFAULT_MODEL` | `claude-3-5-sonnet-20241022` | Default LLM model |
   | `DEFAULT_PROVIDER` | `anthropic` | Default LLM provider |

3. **Start the application:**
   ```bash
   docker compose up -d
   ```

   The app will be available at **[http://localhost:3000](http://localhost:3000)**.
   Data is persisted in the `./data` directory on your host.

4. **Stop the application:**
   ```bash
   docker compose down
   ```

### Manual Docker Build & Run

If you prefer to build and run without Compose:

```bash
# Build the image
docker build -t openmacaw .

# Run the container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  --restart unless-stopped \
  openmacaw
```

> **Note:** On Windows PowerShell, replace `$(pwd)` with `${PWD}`.

---

## 🗺️ Roadmap
- [ ] **Phase 1:** Core Rust daemon integration & Planner-Executor data structures.
- [ ] **Phase 2:** Cross-platform Accessibility hooks and environment observation implementation.
- [ ] **Phase 3:** Interactive Approval UI (The "Ghost" CLI/GUI).
- [ ] **Phase 4:** Public Alpha Release.

## ⚔️ Call to Arms: Define the Future
We are at the precipice of something revolutionary. We are calling on elite **Rust** engineers who are passionate about systems programming, security-first architectures, and natively compiled applications.

We need your expertise to define the initial, modular architecture. Help us build the auditable Planner-Executor engine and the cross-platform accessibility bridges to safely automate the world.

**Join the squadron. Let's build the agent the world deserves.**

[Get Early Access](https://openmacaw.com) | [Open an Issue](https://github.com/OpenMacaw/OpenMacaw/issues)

---
*Inspired by OpenClaw. Reimagined for safety and precision.*
