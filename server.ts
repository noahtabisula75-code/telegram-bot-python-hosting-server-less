import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { spawn, exec, ChildProcess } from "child_process";
import { fileURLToPath } from "url";

// Handle ESM directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Setup workspace
const WORKSPACE = path.join(process.cwd(), "bot_workspace");
if (!fs.existsSync(WORKSPACE)) {
  fs.mkdirSync(WORKSPACE, { recursive: true });
}

// Setup Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = req.query.dir ? String(req.query.dir) : "";
    const target = path.join(WORKSPACE, dir);
    if (!target.startsWith(WORKSPACE)) return cb(new Error("Invalid path"), "");
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    cb(null, target);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

app.use(express.json());

// Bot State
let botProcess: ChildProcess | null = null;
let botStartTime: number | null = null;
let botLogs: string[] = [];
const MAX_LOGS = 1000;

function addLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  botLogs.push(`[${timestamp}] ${msg}`);
  if (botLogs.length > MAX_LOGS) botLogs.shift();
}

// API Routes
app.get("/api/env-check", (req, res) => {
  const pythonCmd = fs.existsSync(path.join(WORKSPACE, "python", "bin", "python3")) ? path.join(WORKSPACE, "python", "bin", "python3") : "python3";
  const pipCmd = fs.existsSync(path.join(WORKSPACE, "python", "bin", "pip3")) ? path.join(WORKSPACE, "python", "bin", "pip3") : "pip3";
  
  exec(`${pythonCmd} --version`, (err) => {
    const hasPython = !err;
    exec(`${pipCmd} --version || pip --version`, (err2) => {
      const hasPip = !err2;
      res.json({ hasPython, hasPip });
    });
  });
});

app.post("/api/upload", upload.array("files"), (req, res) => {
  res.json({ success: true, message: "Files uploaded successfully." });
});

app.get("/api/files", (req, res) => {
  try {
    const dir = req.query.dir ? String(req.query.dir) : "";
    const targetDir = path.join(WORKSPACE, dir);
    
    // Security check to avoid path traversal
    if (!targetDir.startsWith(WORKSPACE)) {
      return res.status(403).json({ error: "Invalid path" });
    }

    if (!fs.existsSync(targetDir)) {
      return res.json({ files: [] });
    }
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    
    const files = entries
      .filter(dirent => !['venv', 'python', '.git'].includes(dirent.name))
      .map(dirent => ({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        path: path.join(dir, dirent.name).replace(/\\/g, "/")
      }));

    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/file-content", (req, res) => {
  const { name } = req.query;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Name is required" });
  
  const filePath = path.join(WORKSPACE, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/save-file", (req, res) => {
  const { name, content } = req.body;
  if (!name || typeof content !== "string") return res.status(400).json({ error: "Name and content required" });

  const filePath = path.join(WORKSPACE, name);
  if (!filePath.startsWith(WORKSPACE)) return res.status(403).json({ error: "Invalid path" });

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/create-folder", (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: "Path is required" });
  
  const target = path.join(WORKSPACE, folderPath);
  if (!target.startsWith(WORKSPACE)) return res.status(403).json({ error: "Invalid path" });
  
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/delete-file", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const filePath = path.join(WORKSPACE, name);
  if (!filePath.startsWith(WORKSPACE)) return res.status(403).json({ error: "Invalid path" });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  try {
    if (fs.statSync(filePath).isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/download-file", (req, res) => {
  const { name } = req.query;
  if (!name || typeof name !== "string") return res.status(400).send("Name is required");
  
  const filePath = path.join(WORKSPACE, name);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

app.post("/api/bot-input", (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: "Input is required" });
  
  if (botProcess && botProcess.stdin) {
    try {
      botProcess.stdin.write(input + "\n");
      addLog(`[STDIN]: ${input}`);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  } else {
    res.status(400).json({ error: "Bot is not running or stdin unavailable" });
  }
});

app.post("/api/install-python", (req, res) => {
  addLog("Attempting to install standalone Python environment...");
  if (botProcess) {
    return res.status(400).json({ error: "Cannot install Python while something is running." });
  }

  const arch = process.arch;
  const platform = process.platform;
  addLog(`Detected architecture: ${platform} ${arch}`);

  // Download Python Standalone
  // Using indygreg's python-build-standalone
  let pyUrl = "https://github.com/indygreg/python-build-standalone/releases/download/20240224/cpython-3.12.2+20240224-x86_64-unknown-linux-gnu-install_only.tar.gz";
  
  if (arch === "arm64" || arch === "aarch64") {
    pyUrl = "https://github.com/indygreg/python-build-standalone/releases/download/20240224/cpython-3.12.2+20240224-aarch64-unknown-linux-gnu-install_only.tar.gz";
  }

  addLog(`Downloading Python from: ${pyUrl}`);
  addLog("This will take a minute or two...");

  // We can just use curl and tar
  const cmd = `curl -L "${pyUrl}" -o python.tar.gz && tar -xzf python.tar.gz -C bot_workspace && rm python.tar.gz`;
  
  exec(cmd, { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
    if (error) {
      addLog(`[INSTALL ERROR]: ${error.message}`);
      res.json({ success: false, error: error.message });
    } else {
      addLog("Successfully extracted standalone Python to bot_workspace/python!");
      // Standalone build puts python in python/install/bin/python3
      addLog("Verifying python installation...");
      exec("./python/bin/python3 --version", { cwd: WORKSPACE }, (err2, out2, errOut2) => {
        if (err2) {
           addLog(`[VERIFY ERROR]: ${err2.message}`);
        } else {
           addLog(`[PYTHON VERSION]: ${out2.trim()}`);
        }
        res.json({ success: true });
      });
    }
  });
});

app.post("/api/install", (req, res) => {
  const reqFile = path.join(WORKSPACE, "requirements.txt");
  if (!fs.existsSync(reqFile)) {
    return res.status(400).json({ error: "requirements.txt not found in workspace." });
  }
  
  if (botProcess) {
    return res.status(400).json({ error: "Cannot install requirements while bot is running." });
  }

  addLog("Running: pip3 install -r requirements.txt ...");
  
  const pipCmd = fs.existsSync(path.join(WORKSPACE, "python", "bin", "pip3")) 
    ? path.join(WORKSPACE, "python", "bin", "pip3") 
    : "pip3";

  const pipCommand = fs.existsSync(path.join(WORKSPACE, "venv")) 
    ? "./venv/bin/pip install -r requirements.txt"
    : `${pipCmd} install -r requirements.txt --break-system-packages`;
    
  exec(pipCommand, { cwd: WORKSPACE }, (error, stdout, stderr) => {
    if (error) addLog(`[PIP ERROR]: ${error.message}`);
    if (stdout) addLog(`[PIP OUT]: ${stdout}`);
    if (stderr) addLog(`[PIP ERR]: ${stderr}`);
    
    if (error && !pipCommand.includes("venv")) {
      // Fallback try with generic pip just in case
      addLog("pip3 failed, trying generic pip...");
      exec("pip install -r requirements.txt --break-system-packages", { cwd: WORKSPACE }, (err2, out2, errOut2) => {
        if (err2) addLog(`[PIP ERROR]: ${err2.message}`);
        if (out2) addLog(`[PIP OUT]: ${out2}`);
        if (errOut2) addLog(`[PIP ERR]: ${errOut2}`);
        res.json({ success: !err2 });
      });
    } else {
      addLog("Requirements installed successfully.");
      res.json({ success: true });
    }
  });
});

app.post("/api/start", (req, res) => {
  const { scriptName } = req.body;
  if (!scriptName) return res.status(400).json({ error: "scriptName is required." });

  if (botProcess) {
    return res.status(400).json({ error: "Bot is already running." });
  }

  const scriptPath = path.join(WORKSPACE, scriptName);
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: `Script '${scriptName}' not found.` });
  }

  let pythonCmd = "python3";
  if (fs.existsSync(path.join(WORKSPACE, "venv"))) {
    pythonCmd = "./venv/bin/python";
  } else if (fs.existsSync(path.join(WORKSPACE, "python", "bin", "python3"))) {
    pythonCmd = path.join(WORKSPACE, "python", "bin", "python3");
  }

  addLog(`Starting bot: ${pythonCmd} ${scriptName}`);
  try {
    botProcess = spawn(pythonCmd, ["-u", scriptName], { cwd: WORKSPACE });
    botStartTime = Date.now();

    botProcess.stdout?.on("data", (data) => {
      const lines = data.toString().trim().split("\n");
      lines.forEach((l: string) => l && addLog(`[OUT]: ${l}`));
    });

    botProcess.stderr?.on("data", (data) => {
      const lines = data.toString().trim().split("\n");
      lines.forEach((l: string) => l && addLog(`[ERR]: ${l}`));
    });

    botProcess.on("close", (code) => {
      addLog(`Bot process exited with code ${code}`);
      botProcess = null;
      botStartTime = null;
    });

    botProcess.on("error", (err: Error) => {
      addLog(`[SYSTEM ERROR]: Failed to start bot (${err.message}). Is python3 installed?`);
      botProcess = null;
      botStartTime = null;
      
      // Fallback to python
      addLog("Falling back to generic 'python' instead of 'python3'...");
      try {
        botProcess = spawn("python", ["-u", scriptName], { cwd: WORKSPACE });
        botProcess.stdout?.on("data", (data) => addLog(`[OUT]: ${data.toString().trim()}`));
        botProcess.stderr?.on("data", (data) => addLog(`[ERR]: ${data.toString().trim()}`));
        botProcess.on("close", (code) => {
          addLog(`Bot process exited with code ${code}`);
          botProcess = null;
        });
        botProcess.on("error", (err2: Error) => {
           addLog(`[SYSTEM ERROR]: Fallback failed too (${err2.message}). Python might not be installed in this container.`);
           botProcess = null;
           botStartTime = null;
        });
      } catch (fallbackErr) {
         addLog(`[SYSTEM ERROR]: ${String(fallbackErr)}`);
      }
    });

    res.json({ success: true });
  } catch (e) {
    addLog(`[SYSTEM ERROR]: ${String(e)}`);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/stop", (req, res) => {
  if (!botProcess) {
    return res.status(400).json({ error: "Bot is not running." });
  }
  
  addLog("Sending kill signal to bot...");
  botProcess.kill();
  botProcess = null; // force clear if it takes a while
  
  res.json({ success: true });
});

app.post("/api/clear-logs", (req, res) => {
  botLogs = [];
  res.json({ success: true });
});

app.get("/api/status", (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = (usedMem / totalMem) * 100;

  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  // Simple heuristic for percent
  const cpuLoadPercent = cpus.length > 0 ? (loadAvg[0] / cpus.length) * 100 : 0;

  res.json({ 
    running: !!botProcess, 
    logs: botLogs,
    uptime: botStartTime ? Date.now() - botStartTime : null,
    system: {
      ram: {
        used: usedMem,
        total: totalMem,
        percent: memUsagePercent
      },
      cpu: {
        percent: cpuLoadPercent
      }
    }
  });
});

// Vite & Static file serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
