import React, { useState, useEffect, useRef } from "react";
import { Upload, Play, Square, Terminal, FileText, Package, Trash2, RotateCcw, Plus, Edit3, Settings, Download, CornerDownLeft, FolderPlus, Folder, ChevronLeft } from "lucide-react";

interface FileItem {
  name: string;
  isDirectory: boolean;
  path: string;
}

export function BotDashboard() {
  const [currentDir, setCurrentDir] = useState<string>("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedScript, setSelectedScript] = useState<string>("");
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runtime, setRuntime] = useState<number | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [sysStats, setSysStats] = useState<{ramPercent: number, cpuPercent: number, ramUsed: number, ramTotal: number} | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [terminalInput, setTerminalInput] = useState("");
  const [envCheck, setEnvCheck] = useState({ hasPython: true, hasPip: true });
  
  // Custom dialogs to replace window.prompt / confirm / alert in iframes
  const [promptDialog, setPromptDialog] = useState<{ isOpen: boolean, title: string, placeholder: string, onConfirm: (val: string) => void } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null);
  const [alertDialog, setAlertDialog] = useState<{ isOpen: boolean, title: string, message: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const start = Date.now();
      const res = await fetch("/api/status");
      if (!res.ok) return;
      const text = await res.text();
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<!doctype")) return;
      const data = JSON.parse(text);
      const end = Date.now();
      
      setIsRunning(data.running);
      setLogs(data.logs);
      setRuntime(data.uptime);
      setPing(end - start);
      if (data.system) {
        setSysStats({
          ramPercent: data.system.ram.percent,
          cpuPercent: data.system.cpu.percent,
          ramUsed: data.system.ram.used,
          ramTotal: data.system.ram.total,
        });
      }
    } catch (e) {
      console.error("Failed to fetch status", e);
    }
  };

  const fetchEnv = async () => {
    try {
      const res = await fetch("/api/env-check");
      if (!res.ok) return;
      const text = await res.text();
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<!doctype")) return;
      const data = JSON.parse(text);
      setEnvCheck(data);
    } catch (e) {
      console.error("Failed to fetch env", e);
    }
  };

  const fetchFiles = async (dir = currentDir) => {
    try {
      const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
      if (!res.ok) return;
      const text = await res.text();
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<!doctype")) return;
      const data = JSON.parse(text);
      
      setFiles(data.files || []);
      if (!selectedScript && !dir && data.files?.length > 0) {
        const pyFile = data.files.find((f: FileItem) => f.name.endsWith(".py") && !f.isDirectory);
        if (pyFile) setSelectedScript(pyFile.path);
      }
      setCurrentDir(dir);
    } catch (e) {
      console.error("Failed to fetch files", e);
    }
  };

  useEffect(() => {
    fetchEnv();
    fetchFiles();
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Scroll to bottom of logs
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs.length]);

  const formatRuntime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleClearLogs = async () => {
    try {
      await fetch("/api/clear-logs", { method: "POST" });
      setLogs([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendTerminalInput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;
    try {
      await fetch("/api/bot-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: terminalInput }),
      });
      setTerminalInput("");
    } catch (e) {
      console.error("Failed to send input", e);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;
    
    setIsUploading(true);
    const formData = new FormData();
    for (let i = 0; i < event.target.files.length; i++) {
        formData.append("files", event.target.files[i]);
    }

    try {
      const res = await fetch(`/api/upload?dir=${encodeURIComponent(currentDir)}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      await fetchFiles(currentDir);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      console.error("Failed to upload", e);
      setAlertDialog({ isOpen: true, title: "Error", message: `Failed to upload files: ${String(e)}` });
    } finally {
      setIsUploading(false);
    }
  };

  const handleEditFile = async (filename: string) => {
    setEditingFile(filename);
    setFileContent("Loading...");
    try {
      const res = await fetch(`/api/file-content?name=${encodeURIComponent(filename)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        setFileContent(data.content);
      } else {
        setFileContent("");
      }
    } catch (e) {
      console.error(e);
      setFileContent("Error loading file.");
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    setIsSaving(true);
    try {
      await fetch("/api/save-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingFile, content: fileContent }),
      });
      // Optionally fetch files again
      await fetchFiles(currentDir);
    } catch (e) {
      console.error(e);
      setAlertDialog({ isOpen: true, title: "Error", message: "Failed to save file" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFile = (filename: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete File?",
      message: `Are you sure you want to delete ${filename}?`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await fetch("/api/delete-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: filename }),
          });
          if (editingFile === filename) setEditingFile(null);
          if (selectedScript === filename) setSelectedScript("");
          await fetchFiles(currentDir);
        } catch (e) {
          console.error(e);
        }
      }
    });
  };

  const handleCreateFile = () => {
    setPromptDialog({
      isOpen: true,
      title: "Create File",
      placeholder: "Enter new file name (e.g., test.py, .env)",
      onConfirm: async (filename) => {
        setPromptDialog(null);
        if (!filename) return;
        
        const targetPath = currentDir ? `${currentDir}/${filename}` : filename;
        
        // Default content for some files
        let content = "";
        if (filename.endsWith(".py")) content = "print('Hello World!')\n";
        if (filename === ".env") content = "TELEGRAM_TOKEN=your_token_here\n";

        try {
          const res = await fetch("/api/save-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: targetPath, content: content }),
          });
          
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Unknown error");
          }
          
          await fetchFiles(currentDir);
          setEditingFile(targetPath);
          setFileContent(content);
        } catch (e) {
          console.error(e);
          setAlertDialog({ isOpen: true, title: "Error", message: `Failed to create file: ${String(e)}` });
        }
      }
    });
  };

  const handleCreateFolder = () => {
    setPromptDialog({
      isOpen: true,
      title: "Create Folder",
      placeholder: "Enter new folder name",
      onConfirm: async (folderName) => {
        setPromptDialog(null);
        if (!folderName) return;
        
        const targetPath = currentDir ? `${currentDir}/${folderName}` : folderName;
        try {
          const res = await fetch("/api/create-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: targetPath }),
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Unknown error");
          }
          await fetchFiles(currentDir);
        } catch (e) {
          console.error(e);
          setAlertDialog({ isOpen: true, title: "Error", message: `Failed to create folder: ${String(e)}` });
        }
      }
    });
  };

  const handleInstallRequirements = async () => {
    setIsInstalling(true);
    try {
      await fetch("/api/install", { method: "POST" });
      // The backend logs the progress which we poll.
    } catch (e) {
      console.error("Install failed", e);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleStartBot = async () => {
    try {
      await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptName: selectedScript }),
      });
      fetchStatus();
    } catch (e) {
      console.error("Start failed", e);
    }
  };

  const handleStopBot = async () => {
    try {
      await fetch("/api/stop", { method: "POST" });
      fetchStatus();
    } catch (e) {
      console.error("Stop failed", e);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-neutral-800 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Python Bot Host</h1>
             <p className="text-neutral-400 mt-1 cursor-help group relative">
               Host and manage your Telegram bot
               <span className="invisible group-hover:visible absolute top-full left-0 mt-2 bg-neutral-800 text-xs text-neutral-300 p-2 rounded w-64 shadow-xl z-50">
                 Note: Your bot stays running as long as this server is active. High traffic helps keep it alive. If the container sleeps, you may need to visit the link again to wake it.
               </span>
             </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
             <div className="flex flex-col items-end text-xs font-mono text-neutral-500 mr-2">
                {sysStats && (
                  <div className="flex space-x-3 text-[10px] text-neutral-400">
                     <span>RAM: {formatBytes(sysStats.ramUsed)} / {formatBytes(sysStats.ramTotal)} ({sysStats.ramPercent.toFixed(1)}%)</span>
                     <span>CPU: {sysStats.cpuPercent.toFixed(1)}%</span>
                  </div>
                )}
                <div className="flex space-x-3">
                  <span>PING: {ping !== null ? `${ping}ms` : '--'}</span>
                  <span>RUNTIME: {runtime !== null ? formatRuntime(runtime) : '--'}</span>
                </div>
             </div>
             <div className={`px-4 py-2 rounded-full text-sm font-medium flex items-center shadow-sm ${isRunning ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-900/50' : 'bg-neutral-900 text-neutral-400 border border-neutral-800'}`}>
               <span className={`w-2 h-2 rounded-full mr-2 ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-500'}`}></span>
               {isRunning ? "Running" : "Stopped"}
             </div>
          </div>
        </header>

        {(!envCheck.hasPython || !envCheck.hasPip) && (
          <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-4 flex items-start space-x-3">
            <div className="text-rose-400 mt-0.5">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-rose-400 font-medium text-sm">Python Runtime Not Detected</h3>
              <p className="text-rose-300/80 text-sm mt-1">
                The current hosting environment (Google AI Studio Preview) does not have Python {(!envCheck.hasPip && envCheck.hasPython) ? 'or Pip ' : ''}installed natively.
                The bot execution features will be limited or unavailable here.
              </p>
              <div className="mt-3 flex items-center space-x-3">
                <button
                  onClick={async () => {
                    alert("Installing Python... this may take a moment. Check terminal logs.");
                    setEnvCheck({ hasPython: true, hasPip: true }); // optimistic UI hide
                    try {
                      await fetch("/api/install-python", { method: "POST" });
                      setTimeout(fetchEnv, 3000);
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  className="bg-rose-900/50 hover:bg-rose-800 text-rose-200 text-xs font-medium py-1.5 px-3 rounded-md border border-rose-800 shadow-sm transition-colors"
                >
                  Attempt Auto-Install
                </button>
                <p className="text-rose-300/80 text-xs text-balance">
                  Or export the project and run it elsewhere.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative">
          
          {/* Left Sidebar: Workspace & Files */}
          <div className="lg:col-span-4 flex flex-col space-y-6">
            
            {/* Workspace Files */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg flex flex-col h-[400px]">
              <div className="flex justify-between items-center mb-4">
                 <h2 className="text-lg font-semibold text-white flex items-center tracking-tight">
                   <FileText className="w-5 h-5 mr-2 text-blue-400" />
                   Explorer
                   {currentDir && (
                     <span className="text-xs text-neutral-400 ml-2 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]" title={currentDir}>
                       /{currentDir}
                     </span>
                   )}
                 </h2>
                 <div className="flex space-x-1 shrink-0">
                   {currentDir && (
                     <button onClick={() => {
                       const parts = currentDir.split("/");
                       parts.pop();
                       fetchFiles(parts.join("/"));
                     }} className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors" title="Go Up">
                        <ChevronLeft className="w-4 h-4" />
                     </button>
                   )}
                   <button onClick={handleCreateFolder} className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors" title="New Folder">
                      <FolderPlus className="w-4 h-4" />
                   </button>
                   <button onClick={handleCreateFile} className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors" title="New File">
                      <Plus className="w-4 h-4" />
                   </button>
                   <button onClick={() => fetchFiles(currentDir)} className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors" title="Refresh">
                      <RotateCcw className="w-4 h-4" />
                   </button>
                 </div>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {files.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-500">
                    <FileText className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm italic">Folder is empty</p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {files.map((file) => (
                      <li key={file.path} className={`text-sm flex justify-between items-center px-3 py-2 rounded-lg border transition-colors group ${editingFile === file.path ? 'bg-blue-950/30 border-blue-900/50 text-blue-300' : 'bg-neutral-950/50 border-transparent hover:border-neutral-800 text-neutral-300 hover:bg-neutral-900'}`}>
                        <button 
                          onClick={() => {
                            if (file.isDirectory) {
                              fetchFiles(file.path);
                            } else {
                              handleEditFile(file.path);
                            }
                          }}
                          className="flex items-center flex-1 text-left overflow-hidden"
                        >
                          {file.isDirectory ? (
                            <Folder className="w-4 h-4 mr-2 text-amber-500" />
                          ) : (
                            <FileText className={`w-4 h-4 mr-2 ${editingFile === file.path ? 'text-blue-400' : 'text-neutral-500 group-hover:text-neutral-400'}`} />
                          )}
                          <span className="truncate">{file.name}</span>
                        </button>
                        <div className="flex space-x-1 ml-2">
                          {!file.isDirectory && (
                            <a 
                              href={`/api/download-file?name=${encodeURIComponent(file.path)}`}
                              download={file.name}
                              className={`p-1 rounded hover:bg-neutral-800 hover:text-white transition-colors ${editingFile === file.path ? 'text-blue-400/50' : 'text-neutral-600 opacity-0 group-hover:opacity-100'}`}
                              title="Download file"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button 
                            onClick={() => handleDeleteFile(file.path)}
                            className={`p-1 rounded hover:bg-rose-950 hover:text-rose-400 transition-colors ${editingFile === file.path ? 'text-blue-400/50' : 'text-neutral-600 opacity-0 group-hover:opacity-100'}`}
                            title={file.isDirectory ? "Delete folder" : "Delete file"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {files.some(f => f.name === "requirements.txt" && !f.isDirectory) && (
                <div className="mt-4 pt-4 border-t border-neutral-800 shrink-0">
                   <button
                    onClick={handleInstallRequirements}
                    disabled={isInstalling || isRunning}
                    className="w-full bg-neutral-950 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-800 text-neutral-200 text-sm font-medium py-2.5 px-4 rounded-xl flex items-center justify-center transition-all shadow-sm group"
                   >
                     <Package className="w-4 h-4 mr-2 text-neutral-400 group-hover:text-white transition-colors" />
                     {isInstalling ? "Installing..." : "Install requirements.txt"}
                   </button>
                </div>
              )}
            </div>

            {/* Upload Card */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg relative overflow-hidden shrink-0">
              <h2 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center tracking-tight">
                <Upload className="w-4 h-4 mr-2 text-indigo-400" />
                Quick Upload
              </h2>
              
              <div className="border-2 border-dashed border-neutral-800 hover:border-indigo-500/50 hover:bg-neutral-800/50 transition-colors rounded-xl p-5 text-center cursor-pointer relative group">
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={isUploading}
                />
                <div className="w-8 h-8 rounded-full bg-neutral-950 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                  <Upload className="w-4 h-4 text-neutral-400 group-hover:text-white transition-colors" />
                </div>
                <p className="text-sm font-medium text-neutral-300">
                  {isUploading ? "Uploading..." : "Drop files here"}
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  .py, .env, or requirements.txt
                </p>
              </div>
            </div>
            
          </div>

          {/* Right Main Area: Control, Editor & Logs */}
          <div className="lg:col-span-8 flex flex-col space-y-6">
            
            {/* Top Bar Controls */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-lg flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 flex items-center space-x-3 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-1.5 ring-1 ring-inset ring-transparent focus-within:ring-blue-500/30 transition-all">
                <Settings className="w-4 h-4 text-neutral-500 shrink-0" />
                <select
                  value={selectedScript}
                  onChange={(e) => setSelectedScript(e.target.value)}
                  className="w-full bg-transparent text-white text-sm py-1.5 outline-none font-mono"
                >
                  <option value="" disabled>Select main script...</option>
                  {selectedScript && !files.some(f => f.path === selectedScript) && (
                    <option value={selectedScript}>{selectedScript.split('/').pop()} (active)</option>
                  )}
                  {files.filter(f => f.name.endsWith('.py') && !f.isDirectory).map(f => (
                    <option key={f.path} value={f.path}>{f.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex gap-3 shrink-0">
                {!isRunning ? (
                  <button
                    onClick={handleStartBot}
                    disabled={!selectedScript}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white text-sm font-medium py-2 px-6 rounded-xl flex items-center transition-all shadow-sm shadow-emerald-900/20"
                  >
                    <Play className="w-4 h-4 mr-2 fill-current" />
                    Start Bot
                  </button>
                ) : (
                  <button
                    onClick={handleStopBot}
                    className="bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium py-2 px-6 rounded-xl flex items-center transition-all shadow-sm shadow-rose-900/20"
                  >
                    <Square className="w-4 h-4 mr-2 fill-current" />
                    Stop Bot
                  </button>
                )}
              </div>
            </div>

            {/* Split layout: Editor && Terminal */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-[500px]">
              
              {/* File Editor (left) if active, else takes full or hides */}
              {editingFile && (
                <div className="bg-[#0D0D0D] border border-neutral-800 rounded-2xl shadow-xl flex flex-col relative overflow-hidden ring-1 ring-inset ring-white/5">
                  <div className="bg-neutral-900/50 border-b border-neutral-800/80 px-4 py-2.5 flex justify-between items-center backdrop-blur-md">
                    <div className="flex items-center text-xs font-mono text-blue-300/80">
                      <Edit3 className="w-3.5 h-3.5 mr-2" />
                      {editingFile}
                    </div>
                    <div className="flex space-x-2">
                       <button
                         onClick={() => setEditingFile(null)}
                         className="text-neutral-500 hover:text-white px-2 py-1 text-xs transition-colors rounded-lg hover:bg-neutral-800/50 font-medium"
                       >
                         Discard
                       </button>
                      <button
                        onClick={handleSaveFile}
                        disabled={isSaving}
                        className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/20 text-blue-300 disabled:opacity-50 text-xs font-medium py-1 px-3 rounded-lg transition-colors flex items-center"
                      >
                        {isSaving ? "Saving..." : "Save File"}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 relative font-mono text-[13px] leading-relaxed">
                    {/* Simulated line numbers gutter could go here if we wanted robust editor, but let's stick to text area for simplicity, styled well */}
                    <textarea
                      value={fileContent}
                      onChange={(e) => setFileContent(e.target.value)}
                      className="absolute inset-0 w-full h-full bg-transparent text-neutral-300 p-4 outline-none resize-none custom-scrollbar"
                      spellCheck={false}
                      placeholder="Start typing..."
                    />
                  </div>
                </div>
              )}

              {/* Terminal Logs (right or full width) */}
              <div className={`bg-[#0A0A0A] border border-neutral-800 rounded-2xl shadow-xl flex flex-col relative overflow-hidden ring-1 ring-inset ring-white/5 ${!editingFile ? 'md:col-span-2' : ''}`}>
                <div className="bg-neutral-900/50 border-b border-neutral-800/80 px-4 py-2.5 flex justify-between items-center backdrop-blur-md">
                  <div className="flex items-center text-xs font-mono text-neutral-400">
                    <Terminal className="w-3.5 h-3.5 mr-2" />
                    Terminal
                  </div>
                  <button
                    onClick={handleClearLogs}
                    className="p-1 rounded-md text-neutral-600 hover:text-white hover:bg-neutral-800 transition-colors"
                    title="Clear Logs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <div ref={terminalRef} className="flex-1 p-4 overflow-y-auto font-mono text-[13px] leading-relaxed custom-scrollbar bg-[#0A0A0A]">
                  {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-neutral-600 space-y-2 opacity-50">
                      <Terminal className="w-8 h-8" />
                      <span className="italic text-xs">Awaiting output...</span>
                    </div>
                  ) : (
                    logs.map((log, i) => {
                      const isErr = log.includes("[ERR]") || log.includes("[PIP ERROR]");
                      const isSys = log.includes("[SYSTEM ERROR]") || log.includes("[PIP OUT]") || log.includes("Installing") || log.includes("Successfully");
                      const isWarn = log.includes("[APT ERR]") || log.includes("[APK ERR]") || log.includes("Fallback");
                      let colorClass = "text-neutral-300";
                      
                      if (isErr) colorClass = "text-rose-400";
                      else if (isWarn) colorClass = "text-amber-400";
                      else if (isSys) colorClass = "text-indigo-400";
                      else if (log.startsWith("[STDIN]")) colorClass = "text-emerald-400";
                      
                      return (
                         <div key={i} className={`whitespace-pre-wrap break-all py-0.5 ${colorClass}`}>
                           {log}
                         </div>
                      );
                    })
                  )}
                </div>

                {/* Stdin input form */}
                <div className="border-t border-neutral-800/80 bg-neutral-900/40 p-2">
                  <form onSubmit={handleSendTerminalInput} className="flex items-center relative">
                    <span className="absolute left-3 text-emerald-500 font-mono text-sm leading-none">{">"}</span>
                    <input
                      type="text"
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-neutral-700 outline-none rounded-lg py-1.5 pl-8 pr-10 text-xs font-mono text-neutral-300 transition-colors placeholder-neutral-600 focus:ring-1 focus:ring-blue-500/30"
                      placeholder={isRunning ? "Type command or input..." : "Bot is not running"}
                      value={terminalInput}
                      onChange={(e) => setTerminalInput(e.target.value)}
                      disabled={!isRunning}
                      autoComplete="off"
                    />
                    <button 
                      type="submit" 
                      disabled={!isRunning || !terminalInput.trim()}
                      className="absolute right-2 p-1 text-neutral-500 hover:text-white disabled:opacity-50 transition-colors"
                      title="Send configuration / command"
                    >
                      <CornerDownLeft className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
      {/* Custom Modals */}
      {promptDialog?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-4">{promptDialog.title}</h3>
            <input
              autoFocus
              type="text"
              className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500/50 outline-none rounded-xl py-2 px-3 text-sm text-neutral-200 placeholder-neutral-600 transition-colors mb-6"
              placeholder={promptDialog.placeholder}
              onKeyDown={(e) => {
                if (e.key === 'Enter') promptDialog.onConfirm(e.currentTarget.value);
                if (e.key === 'Escape') setPromptDialog(null);
              }}
              id="promptInput"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPromptDialog(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const el = document.getElementById('promptInput') as HTMLInputElement;
                  promptDialog.onConfirm(el?.value || '');
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-neutral-400 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {alertDialog?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">{alertDialog.title}</h3>
            <p className="text-sm text-neutral-400 mb-6 whitespace-pre-wrap">{alertDialog.message}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setAlertDialog(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-white shadow-sm transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
