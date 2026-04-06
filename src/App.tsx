import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { 
  Send, 
  User, 
  Mail, 
  CheckCircle2, 
  AlertCircle, 
  Eye, 
  Calendar, 
  Clock, 
  Video,
  ChevronRight,
  Loader2,
  Lock,
  LogOut,
  Upload,
  FileText,
  Download,
  Trash2
} from "lucide-react";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem("isLoggedIn") === "true";
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });
  const [showPreview, setShowPreview] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [showTestInput, setShowTestInput] = useState(false);

  // Bulk Sending State
  const [bulkData, setBulkData] = useState<{ name: string; email: string; company?: string }[]>([]);
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [bulkReport, setBulkReport] = useState<{ name: string; email: string; company?: string; status: string; error?: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [senderEmail, setSenderEmail] = useState("marketing@xmonks.com");
  const senderName = senderEmail.split('@')[0].split('.').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  React.useEffect(() => {
    fetch("/api/config")
      .then(res => res.json())
      .then(data => {
        if (data.gmailUser) {
          setSenderEmail(data.gmailUser);
        }
      })
      .catch(err => console.error("Failed to fetch config:", err));
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "admin" && password === "nimda") {
      setIsLoggedIn(true);
      localStorage.setItem("isLoggedIn", "true");
      setLoginError("");
    } else {
      setLoginError("Invalid username or password.");
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem("isLoggedIn");
    setUsername("");
    setPassword("");
  };

  const handleSendEmail = async (e: React.FormEvent, isTest: boolean = false, targetEmail?: string) => {
    if (e) e.preventDefault();
    
    const emailToUse = isTest ? targetEmail : clientEmail;
    const nameToUse = clientName || (isTest ? "Test User" : "");

    if (!emailToUse) {
      setStatus({ type: "error", message: "Please provide an email address." });
      return;
    }

    if (isTest) setIsSendingTest(true);
    else setIsSending(true);
    
    setStatus({ type: null, message: "" });

    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          clientName: nameToUse, 
          clientEmail: emailToUse,
          companyName: companyName || (isTest ? "Test Company" : ""),
          isTest
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setStatus({ 
          type: "success", 
          message: isTest ? `Test email sent to ${emailToUse}!` : "Welcome email sent successfully!" 
        });
        if (!isTest) {
          setClientName("");
          setClientEmail("");
          setCompanyName("");
        } else {
          setShowTestInput(false);
        }
      } else {
        setStatus({ type: "error", message: data.error || "Failed to send email." });
      }
    } catch (error) {
      setStatus({ type: "error", message: "An unexpected error occurred." });
    } finally {
      setIsSending(false);
      setIsSendingTest(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (extension === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsedData = results.data.map((row: any) => ({
            name: row.Name || row.name || row.NAME || "",
            email: row.Email || row.email || row.EMAIL || "",
            company: row.Company || row.company || row.COMPANY || "",
          })).filter(item => item.email);
          setBulkData(parsedData);
        },
      });
    } else if (extension === "xlsx" || extension === "xls") {
      reader.onload = (event) => {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        const parsedData = jsonData.map((row: any) => ({
          name: row.Name || row.name || row.NAME || "",
          email: row.Email || row.email || row.EMAIL || "",
          company: row.Company || row.company || row.COMPANY || "",
        })).filter(item => item.email);
        setBulkData(parsedData);
      };
      reader.readAsArrayBuffer(file);
    } else {
      setStatus({ type: "error", message: "Please upload a valid CSV or Excel file." });
    }
  };

  const handleBulkSend = async () => {
    if (bulkData.length === 0) return;

    setIsBulkSending(true);
    setBulkProgress({ current: 0, total: bulkData.length });
    const report: typeof bulkReport = [];

    for (let i = 0; i < bulkData.length; i++) {
      const client = bulkData[i];
      setBulkProgress(prev => ({ ...prev, current: i + 1 }));

      try {
        const response = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientName: client.name,
            clientEmail: client.email,
            companyName: client.company || "",
            isTest: false,
          }),
        });

        const data = await response.json();
        if (response.ok) {
          report.push({ ...client, status: "Success" });
        } else {
          report.push({ ...client, status: "Failed", error: data.error || "Unknown error" });
        }
      } catch (error) {
        report.push({ ...client, status: "Failed", error: "Network error" });
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setBulkReport(report);
    setIsBulkSending(false);
    setBulkData([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStatus({ type: "success", message: `Bulk sending completed! ${report.filter(r => r.status === "Success").length} succeeded, ${report.filter(r => r.status === "Failed").length} failed.` });
  };

  const downloadReport = () => {
    if (bulkReport.length === 0) return;
    const csv = Papa.unparse(bulkReport);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, `email_report_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-sans selection:bg-orange-100">
      {!isLoggedIn ? (
        <div className="min-h-screen flex flex-col md:flex-row bg-white">
          {/* Left Side: Image */}
          <div className="hidden md:block md:w-1/2 lg:w-3/5 relative overflow-hidden">
            <img 
              src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=2071&auto=format&fit=crop" 
              alt="Professional Coaching Session"
              className="absolute inset-0 w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            {/* Note: To use your specific attached image, upload it to the project (e.g., as 'login-hero.jpg') and update the src above to '/login-hero.jpg' */}
            <div className="absolute inset-0 bg-gradient-to-t from-orange-900/60 via-transparent to-transparent" />
            <div className="absolute bottom-12 left-12 text-white z-10 max-w-lg">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="w-12 h-1 bg-orange-400 mb-6" />
                <h2 className="text-4xl lg:text-5xl font-bold mb-4 tracking-tight leading-tight">
                  Building Stronger Leaders
                </h2>
                <p className="text-lg lg:text-xl text-orange-50 font-medium opacity-90 max-w-md">
                  Welcome to the xMonks Portal. Design leadership journeys that create real, measurable impact.
                </p>
              </motion.div>
            </div>
          </div>

          {/* Right Side: Login Portal */}
          <div className="flex-1 flex items-center justify-center p-8 sm:p-12 lg:p-16">
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="w-full max-w-md space-y-10"
            >
              <div className="space-y-4">
                <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center shadow-xl shadow-orange-100 mb-6">
                  <Lock className="text-white w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Portal Login</h1>
                  <p className="text-slate-500 text-lg">Please enter your credentials to access the Welcome Portal.</p>
                </div>
              </div>

              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Username</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                        <User className="w-5 h-5" />
                      </div>
                      <input
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter your username"
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Password</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                        <Lock className="w-5 h-5" />
                      </div>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                {loginError && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-3 text-rose-600"
                  >
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm font-semibold">{loginError}</p>
                  </motion.div>
                )}

                <button
                  type="submit"
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-xl shadow-xl shadow-orange-100 transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 group"
                >
                  Sign In
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </form>

              <div className="pt-8 border-t border-slate-100 text-center">
                <p className="text-sm text-slate-400">
                  © 2026 xMonks
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-200">
                  <Send className="text-white w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight text-slate-900">xMonks</h1>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Client Outreach Portal</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden sm:block">
                  <span className="text-sm text-slate-400">Logged in as {senderEmail}</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </header>

          <main className="max-w-4xl mx-auto px-4 py-12 space-y-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          
          {/* Form Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Reach Out to Client</h2>
              <p className="text-slate-500">Enter the client details to send the xMonks leadership outreach email.</p>
            </div>

            <form onSubmit={handleSendEmail} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400" />
                    Client Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all outline-none placeholder:text-slate-300"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-slate-400" />
                    Client Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="e.g. john@example.com"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all outline-none placeholder:text-slate-300"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="company" className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400" />
                    Company Name
                  </label>
                  <input
                    id="company"
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all outline-none placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  type="submit"
                  disabled={isSending}
                  className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-orange-200 transition-all flex items-center justify-center gap-2 group"
                >
                  {isSending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Send Outreach Email
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="px-6 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-slate-700 transition-all flex items-center justify-center gap-2"
                >
                  <Eye className="w-4 h-4" />
                  {showPreview ? "Hide Preview" : "Preview Email"}
                </button>
              </div>

              <div className="pt-4 border-t border-slate-100">
                {!showTestInput ? (
                  <button
                    type="button"
                    onClick={() => setShowTestInput(true)}
                    className="text-sm font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-2 transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    Send a test email to yourself
                  </button>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-3"
                  >
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Test Email Recipient</p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="your-email@example.com"
                        className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <button
                        type="button"
                        disabled={isSendingTest || !testEmail}
                        onClick={() => handleSendEmail(null as any, true, testEmail)}
                        className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-900 disabled:bg-slate-300 transition-all flex items-center gap-2"
                      >
                        {isSendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Test"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowTestInput(false)}
                        className="text-sm text-slate-400 hover:text-slate-600 px-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </form>

            <AnimatePresence>
              {status.type && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`p-4 rounded-xl flex items-start gap-3 ${
                    status.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-700 border border-rose-100"
                  }`}
                >
                  {status.type === "success" ? (
                    <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  )}
                  <p className="text-sm font-medium">{status.message}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Info Card Section */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-8"
          >
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-slate-900">Outreach Overview</h3>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Purpose</p>
                    <p className="text-sm text-slate-500">Leadership Journey Outreach</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Sender</p>
                    <p className="text-sm text-slate-500">{senderName}</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Attachment</p>
                    <p className="text-sm text-slate-500">REDEFINE WHAT’S POSSIBLE PDF</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Key Message</p>
              <p className="text-sm text-slate-600 italic">
                "We help HR and L&D leaders design leadership journeys that create real, measurable impact."
              </p>
            </div>
          </motion.div>
        </div>

        {/* Bulk Upload Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Upload className="w-5 h-5 text-orange-600" />
                Bulk Outreach
              </h3>
              <p className="text-sm text-slate-500">Upload a CSV or Excel file with "Name", "Email", and "Company" columns.</p>
            </div>
            {bulkReport.length > 0 && (
              <button
                onClick={downloadReport}
                className="flex items-center gap-2 text-sm font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100 transition-all"
              >
                <Download className="w-4 h-4" />
                Download Last Report
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="relative group">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".csv, .xlsx, .xls"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="border-2 border-dashed border-slate-200 group-hover:border-orange-400 rounded-2xl p-8 transition-all flex flex-col items-center justify-center gap-3 bg-slate-50 group-hover:bg-orange-50/30">
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center">
                  <FileText className="w-6 h-6 text-slate-400 group-hover:text-orange-500 transition-colors" />
                </div>
                <p className="text-sm font-semibold text-slate-600">
                  {bulkData.length > 0 ? `${bulkData.length} clients loaded` : "Click or drag file here"}
                </p>
                <p className="text-xs text-slate-400">Supports .csv, .xlsx, .xls</p>
              </div>
            </div>

            <div className="flex flex-col justify-center gap-4">
              {bulkData.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">Ready to send</span>
                    <button 
                      onClick={() => {
                        setBulkData([]);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="text-slate-400 hover:text-rose-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    onClick={handleBulkSend}
                    disabled={isBulkSending}
                    className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:bg-slate-300"
                  >
                    {isBulkSending ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Sending {bulkProgress.current}/{bulkProgress.total}
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Start Bulk Sending
                      </>
                    )}
                  </button>
                </div>
              )}
              
              {isBulkSending && (
                <div className="space-y-2">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-orange-600"
                      initial={{ width: 0 }}
                      animate={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-center text-slate-500 font-medium">
                    Processing... Please do not close the tab.
                  </p>
                </div>
              )}

              {!isBulkSending && bulkData.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-slate-100 rounded-2xl bg-slate-50/50">
                  <p className="text-sm text-slate-400">No file selected for bulk processing.</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Email Preview Modal-like Section */}
        <AnimatePresence>
          {showPreview && (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="mt-16 bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="bg-slate-900 px-8 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500" />
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                </div>
                <p className="text-xs font-mono text-slate-400">Email Preview Mode</p>
              </div>
              
              <div className="p-8 sm:p-12 max-w-2xl mx-auto bg-slate-50">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="bg-slate-900 px-8 py-10 text-center">
                    <h1 className="text-white text-3xl font-extrabold tracking-tight">xMonks</h1>
                    <p className="text-slate-400 mt-2 text-sm">Building Stronger Leaders</p>
                  </div>
                  
                  <div className="p-8 sm:p-10 text-slate-700 leading-relaxed space-y-6">
                    <p className="text-lg font-semibold text-slate-900">Hi {clientName ? clientName.split(" ")[0] : "<First Name>"},</p>
                    
                    <p>I'll keep this brief, I know your inbox is busy.</p>
                    
                    <p>
                      I'm <span className="font-semibold">{senderName.split(' ')[0]}</span> from xMonks. We help HR and L&D leaders at organisations like <span className="font-semibold">Bosch, Flipkart, Tata Steel, and PUMA</span> design leadership journeys that create real, measurable impact.
                    </p>

                    <div className="bg-orange-50 border-l-4 border-orange-600 p-5 rounded-r-lg">
                      <p className="text-orange-900 text-sm leading-relaxed">
                        <span className="font-semibold">What sets us apart</span> is an ecosystem approach that blends globally accredited coach training with customised interventions tailored to your organisation's specific leadership challenges, not a generic framework.
                      </p>
                    </div>

                    <p>
                      I'd love to explore whether there's a fit with <span className="font-semibold">{companyName || "<Company Name>"}</span>'s leadership agenda. Would you have 30 minutes available this week or next? Happy to work around your schedule.
                    </p>

                    <div className="text-center pt-4 pb-6">
                      <a href="https://calendly.com/shubhankar-sethi-xmonks/30min" target="_blank" rel="noopener noreferrer" className="inline-block bg-orange-600 text-white font-semibold py-3 px-8 rounded-lg shadow-sm hover:bg-orange-700 transition-colors">
                        Let's Connect for 30 Mins
                      </a>
                    </div>

                    <div className="border-t border-slate-200 pt-8 flex flex-col sm:flex-row gap-8">
                      <div className="flex-1">
                        <p className="text-slate-500 text-sm mb-2">Warm regards,</p>
                        <p className="font-bold text-slate-900 text-lg">{senderName}</p>
                        <p className="text-sm text-slate-500">xMonks Team</p>
                        <p className="text-sm font-bold text-orange-600 mt-1">xMonks</p>
                      </div>
                      <div className="flex-1 sm:border-l border-slate-200 sm:pl-8 space-y-2 text-sm text-slate-600">
                        <p><span className="text-orange-600 mr-2">📞</span> +91-99991-99929</p>
                        <p><span className="text-orange-600 mr-2">✉️</span> {senderEmail}</p>
                        <p><span className="text-orange-600 mr-2">🌐</span> <span className="font-semibold text-orange-600">www.xmonks.com</span></p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 border-t border-slate-200 px-8 py-8 text-center flex flex-col items-center">
                    <p className="text-sm text-slate-500 mb-4 font-medium">Included Resource:</p>
                    <a href="https://xmonks.com/REDEFINE%20WHAT%E2%80%99S%20POSSIBLE%20-%20xMonks.pdf" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-white border-2 border-orange-600 text-orange-600 font-bold py-2.5 px-6 rounded-lg hover:bg-orange-50 transition-colors text-sm">
                      📄 View PDF Resource
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-12 text-center text-slate-400 text-sm">
        <p>© 2026 xMonks. All rights reserved.</p>
      </footer>
        </>
      )}
    </div>
  );
}
