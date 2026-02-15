package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/rs/cors"
)

type TestRequest struct {
	Target   string `json:"target"`
	Protocol string `json:"protocol"`
	Port     string `json:"port"`
	Timeout  int    `json:"timeout"` // Timeout in seconds
}

type TestResult struct {
	Protocol string `json:"protocol"`
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	Duration string `json:"duration"`
}

type TestResponse struct {
	Results []TestResult `json:"results"`
}

type DNSRequest struct {
	Hostname string `json:"hostname"`
}

type DNSResult struct {
	Hostname  string   `json:"hostname"`
	Addresses []string `json:"addresses"`
	Success   bool     `json:"success"`
	Message   string   `json:"message"`
}

type NetworkInterface struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	IPAddress  string `json:"ipAddress"`
	SubnetMask string `json:"subnetMask"`
	MACAddress string `json:"macAddress"`
}

type SystemInfo struct {
	Hostname          string             `json:"hostname"`
	OS                string             `json:"os"`
	HostIPs           []string           `json:"hostIps"`
	DNSServers        []string           `json:"dnsServers"`
	GatewayIPs        []string           `json:"gatewayIps"`
	NetworkInterfaces []NetworkInterface `json:"networkInterfaces"`
}

func main() {
	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/test", handleTest)
	mux.HandleFunc("/api/test/stream", handleTestStream)
	mux.HandleFunc("/api/traceroute", handleTraceroute)
	mux.HandleFunc("/api/dns", handleDNS)
	mux.HandleFunc("/api/sysinfo", handleSysInfo)
	mux.HandleFunc("/api/health", handleHealth)

	// Serve static assets and CSS from frontend build output
	mux.Handle("/static/", http.FileServer(http.Dir("frontend/build")))
	// Serve index.html for all other routes (SPA fallback)
	mux.HandleFunc("/", spaHandler)
	log.Println("Serving frontend from frontend/build directory")

	// Enable CORS for API endpoints
	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: true,
	}).Handler(mux)

	port := ":8080"
	log.Printf("Server starting on http://localhost%s", port)
	log.Println("Access the application at: http://localhost:8080")
	log.Fatal(http.ListenAndServe(port, handler))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}

func spaHandler(w http.ResponseWriter, r *http.Request) {
	// Serve index.html for all routes (React Router handles client-side routing)
	data, err := ioutil.ReadFile("frontend/build/index.html")
	if err != nil {
		http.Error(w, "index.html not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	w.Write(data)
}

func handleSysInfo(w http.ResponseWriter, r *http.Request) {
	sysInfo := SystemInfo{
		Hostname:          getHostname(),
		OS:                getOSVersion(),
		HostIPs:           getHostIPs(),
		DNSServers:        getDNSServers(),
		GatewayIPs:        getGatewayIPs(),
		NetworkInterfaces: getNetworkInterfaces(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sysInfo)
}

func handleTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate target
	if req.Target == "" {
		http.Error(w, "Target is required", http.StatusBadRequest)
		return
	}

	// Default timeout to 10 seconds if not specified or invalid
	timeout := req.Timeout
	if timeout <= 0 || timeout > 60 {
		timeout = 10
	}

	// Run tests based on protocol
	var results []TestResult

	protocols := []string{req.Protocol}
	if req.Protocol == "all" {
		if req.Port != "" {
			// Skip PING when port is specified since PING doesn't use ports
			protocols = []string{"tcp", "udp", "http", "https"}
		} else {
			protocols = []string{"ping", "tcp", "udp", "http", "https"}
		}
	}

	for _, protocol := range protocols {
		result := runTest(req.Target, protocol, req.Port, timeout)
		results = append(results, result)
	}

	response := TestResponse{Results: results}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleTestStream streams test results as they complete using Server-Sent Events
func handleTestStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate target
	if req.Target == "" {
		http.Error(w, "Target is required", http.StatusBadRequest)
		return
	}

	// Default timeout to 10 seconds if not specified or invalid
	timeout := req.Timeout
	if timeout <= 0 || timeout > 60 {
		timeout = 10
	}

	// Set headers for Server-Sent Events
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Determine protocols to test
	protocols := []string{req.Protocol}
	if req.Protocol == "all" {
		if req.Port != "" {
			// Skip PING when port is specified since PING doesn't use ports
			protocols = []string{"tcp", "udp", "http", "https"}
		} else {
			protocols = []string{"ping", "tcp", "udp", "http", "https"}
		}
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Stream each test result as it completes
	for _, protocol := range protocols {
		// Send "testing" status
		testingMsg := map[string]interface{}{
			"type":     "testing",
			"protocol": protocol,
		}
		data, _ := json.Marshal(testingMsg)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()

		// Run the test
		result := runTest(req.Target, protocol, req.Port, timeout)

		// Send result
		resultMsg := map[string]interface{}{
			"type":   "result",
			"result": result,
		}
		data, _ = json.Marshal(resultMsg)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// Send completion message
	completionMsg := map[string]interface{}{
		"type": "complete",
	}
	data, _ := json.Marshal(completionMsg)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

func handleTraceroute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate target
	if req.Target == "" {
		http.Error(w, "Target is required", http.StatusBadRequest)
		return
	}

	// Set headers for Server-Sent Events
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Run traceroute without timeout - let it use command defaults
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("tracert", "-h", "30", req.Target)
	} else {
		cmd = exec.Command("traceroute", "-m", "30", req.Target)
	}

	// Create a pipe to capture output in real-time
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	cmd.Start()

	// Send initial message
	fmt.Fprintf(w, "data: %s\n\n", `{"type":"start"}`)
	flusher.Flush()

	// Read and stream output line by line
	scanner := bufio.NewScanner(io.MultiReader(stdout, stderr))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// Send each line as it arrives
		lineMsg := map[string]interface{}{
			"type": "line",
			"text": line,
		}
		data, _ := json.Marshal(lineMsg)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// Wait for command to complete
	err := cmd.Wait()

	var success bool
	var message string
	if err != nil {
		success = false
		message = fmt.Sprintf("Traceroute failed: %s", err.Error())
	} else {
		success = true
		message = "Traceroute completed"
	}

	// Send completion message
	completeMsg := map[string]interface{}{
		"type":    "complete",
		"success": success,
		"message": message,
	}
	data, _ := json.Marshal(completeMsg)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

func handleDNS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DNSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate hostname
	if req.Hostname == "" {
		http.Error(w, "Hostname is required", http.StatusBadRequest)
		return
	}

	// Perform DNS lookup
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Use the default resolver with context timeout
	var resolver net.Resolver
	ips, err := resolver.LookupIPAddr(ctx, req.Hostname)

	result := DNSResult{
		Hostname: req.Hostname,
	}

	if err != nil {
		result.Success = false
		result.Message = fmt.Sprintf("DNS lookup failed: %s", err.Error())
	} else if len(ips) == 0 {
		result.Success = false
		result.Message = "No addresses found"
	} else {
		result.Success = true
		result.Addresses = make([]string, len(ips))
		for i, ip := range ips {
			result.Addresses[i] = ip.String()
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func runTest(target, protocol, port string, timeoutSec int) TestResult {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	var success bool
	var message string

	switch strings.ToLower(protocol) {
	case "ping":
		success, message = testPing(ctx, target)
	case "tcp":
		success, message = testTCP(ctx, target, port)
	case "udp":
		success, message = testUDP(ctx, target, port)
	case "http":
		success, message = testHTTP(ctx, target, port, false)
	case "https":
		success, message = testHTTP(ctx, target, port, true)
	default:
		success = false
		message = fmt.Sprintf("Unknown protocol: %s", protocol)
	}

	duration := time.Since(start)

	return TestResult{
		Protocol: protocol,
		Success:  success,
		Message:  message,
		Duration: fmt.Sprintf("%.2fms", float64(duration.Microseconds())/1000.0),
	}
}

func testPing(ctx context.Context, target string) (bool, string) {
	var cmd *exec.Cmd

	// Use OS-specific ping syntax
	if runtime.GOOS == "windows" {
		// Windows: -n for count, -w for timeout in milliseconds
		cmd = exec.CommandContext(ctx, "ping", "-n", "4", "-w", "10000", target)
	} else {
		// Linux/Mac: -c for count, -W for timeout in seconds
		cmd = exec.CommandContext(ctx, "ping", "-c", "4", "-W", "10", target)
	}

	output, err := cmd.CombinedOutput()

	if ctx.Err() == context.DeadlineExceeded {
		return false, "Timeout: Ping request exceeded timeout limit"
	}

	if err != nil {
		return false, fmt.Sprintf("Ping failed: %s - %s", err.Error(), string(output))
	}

	outputStr := string(output)

	// Check for packet loss (works for both Windows and Linux output)
	if strings.Contains(outputStr, "0 received") ||
		strings.Contains(outputStr, "100% loss") ||
		strings.Contains(outputStr, "(100% loss)") {
		return false, "All packets lost - Host unreachable"
	}

	return true, fmt.Sprintf("Ping successful: %s", summarizePingOutput(outputStr))
}

func summarizePingOutput(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		// Linux/Mac format: "4 packets transmitted, 4 received, 0% packet loss"
		if strings.Contains(line, "packets transmitted") || strings.Contains(line, "packet loss") {
			return strings.TrimSpace(line)
		}
		// Windows format: "Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)"
		if strings.Contains(line, "Packets:") && strings.Contains(line, "Sent") {
			return strings.TrimSpace(line)
		}
	}
	return "Response received"
}

func testTCP(ctx context.Context, target, port string) (bool, string) {
	if port == "" {
		port = "80"
	}

	address := net.JoinHostPort(target, port)

	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", address)

	if ctx.Err() == context.DeadlineExceeded {
		return false, "Timeout: TCP connection exceeded timeout limit"
	}

	if err != nil {
		return false, fmt.Sprintf("TCP connection failed: %s", err.Error())
	}

	conn.Close()
	return true, fmt.Sprintf("TCP connection successful to %s", address)
}

func testUDP(ctx context.Context, target, port string) (bool, string) {
	if port == "" {
		port = "53" // Default DNS port
	}

	address := net.JoinHostPort(target, port)

	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "udp", address)

	if ctx.Err() == context.DeadlineExceeded {
		return false, "Timeout: UDP connection exceeded timeout limit"
	}

	if err != nil {
		return false, fmt.Sprintf("UDP connection failed: %s", err.Error())
	}

	conn.Close()

	// Note: UDP is connectionless, so this mainly checks if we can create a socket
	return true, fmt.Sprintf("UDP socket created for %s (Note: UDP is connectionless, actual delivery cannot be verified)", address)
}

func testHTTP(ctx context.Context, target, port string, useHTTPS bool) (bool, string) {
	scheme := "http"
	if useHTTPS {
		scheme = "https"
	}

	// Build URL
	url := fmt.Sprintf("%s://%s", scheme, target)
	if port != "" {
		url = fmt.Sprintf("%s://%s:%s", scheme, target, port)
	}

	// Use context timeout instead of client timeout
	client := &http.Client{}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return false, fmt.Sprintf("Failed to create request: %s", err.Error())
	}

	resp, err := client.Do(req)

	if ctx.Err() == context.DeadlineExceeded {
		return false, fmt.Sprintf("Timeout: %s request exceeded timeout limit", strings.ToUpper(scheme))
	}

	if err != nil {
		return false, fmt.Sprintf("%s request failed: %s", strings.ToUpper(scheme), err.Error())
	}

	defer resp.Body.Close()

	return true, fmt.Sprintf("%s request successful - Status: %d %s", strings.ToUpper(scheme), resp.StatusCode, resp.Status)
}

// System Information Functions

func getHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "Unknown"
	}
	return hostname
}

func getHostIPs() []string {
	var ips []string

	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}

	for _, iface := range ifaces {
		// Skip down and loopback interfaces
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil || ip.IsLoopback() {
				continue
			}

			// Add both IPv4 and IPv6
			ips = append(ips, ip.String())
		}
	}

	return ips
}

func getDNSServers() []string {
	var dnsServers []string
	seen := make(map[string]bool)

	if runtime.GOOS == "windows" {
		// Windows: Use ipconfig /all
		cmd := exec.Command("powershell", "-Command",
			"Get-DnsClientServerAddress | Where-Object {$_.ServerAddresses} | Select-Object -ExpandProperty ServerAddresses")
		output, err := cmd.Output()
		if err == nil {
			lines := strings.Split(string(output), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line != "" && net.ParseIP(line) != nil && !seen[line] {
					dnsServers = append(dnsServers, line)
					seen[line] = true
				}
			}
		}
	} else {
		// Linux/Mac: Read /etc/resolv.conf
		cmd := exec.Command("cat", "/etc/resolv.conf")
		output, err := cmd.Output()
		if err == nil {
			lines := strings.Split(string(output), "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "nameserver") {
					parts := strings.Fields(line)
					if len(parts) >= 2 {
						dns := parts[1]
						if !seen[dns] {
							dnsServers = append(dnsServers, dns)
							seen[dns] = true
						}
					}
				}
			}
		}
	}

	if len(dnsServers) == 0 {
		dnsServers = append(dnsServers, "Unable to detect")
	}

	return dnsServers
}

func getGatewayIPs() []string {
	var gateways []string

	if runtime.GOOS == "windows" {
		// Windows: Use ipconfig and parse "Default Gateway" entries
		cmd := exec.Command("ipconfig")
		output, err := cmd.Output()
		if err == nil {
			lines := strings.Split(string(output), "\n")
			seen := make(map[string]bool)
			for _, line := range lines {
				if strings.Contains(line, "Default Gateway") {
					// Extract IP from lines like "Default Gateway . . . . . . . . . : 192.168.1.1"
					parts := strings.Split(line, ":")
					if len(parts) >= 2 {
						ip := strings.TrimSpace(parts[len(parts)-1])
						if ip != "" && net.ParseIP(ip) != nil && !seen[ip] {
							gateways = append(gateways, ip)
							seen[ip] = true
						}
					}
				}
			}
		}
	} else {
		// Linux/macOS: Use ip route for IPv4
		cmd := exec.Command("sh", "-c", "ip route | grep default | awk '{print $3}'")
		output, err := cmd.Output()
		seen := make(map[string]bool)
		if err == nil {
			outputStr := strings.TrimSpace(string(output))
			if outputStr != "" {
				lines := strings.Split(outputStr, "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if line != "" && net.ParseIP(line) != nil && !seen[line] {
						gateways = append(gateways, line)
						seen[line] = true
					}
				}
			}
		}

		// Try for IPv6 default routes
		cmd = exec.Command("sh", "-c", "ip -6 route | grep default | awk '{print $3}'")
		output, err = cmd.Output()
		if err == nil {
			outputStr := strings.TrimSpace(string(output))
			if outputStr != "" {
				lines := strings.Split(outputStr, "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if line != "" && net.ParseIP(line) != nil && !seen[line] {
						gateways = append(gateways, line)
						seen[line] = true
					}
				}
			}
		}
	}

	if len(gateways) == 0 {
		gateways = append(gateways, "Unable to detect")
	}

	return gateways
}
func getOSVersion() string {
	if runtime.GOOS == "windows" {
		// Windows: Get OS version from PowerShell
		cmd := exec.Command("powershell", "-Command",
			"(Get-ItemProperty -Path 'HKLM:\\Software\\Microsoft\\Windows NT\\CurrentVersion' -Name ProductName).ProductName + ' ' + (Get-ItemProperty -Path 'HKLM:\\Software\\Microsoft\\Windows NT\\CurrentVersion' -Name CurrentVersion).CurrentVersion")
		output, err := cmd.Output()
		if err == nil {
			return strings.TrimSpace(string(output))
		}
	} else {
		// Linux/macOS: Try to get from /etc/os-release or uname
		cmd := exec.Command("sh", "-c", "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'=' -f2 | tr -d '\"' || uname -s")
		output, err := cmd.Output()
		if err == nil {
			osInfo := strings.TrimSpace(string(output))
			if osInfo != "" {
				return osInfo
			}
		}
	}
	return fmt.Sprintf("%s %s", runtime.GOOS, runtime.GOARCH)
}

func getNetworkInterfaces() []NetworkInterface {
	var interfaces []NetworkInterface

	ifaces, err := net.Interfaces()
	if err != nil {
		return interfaces
	}

	for _, iface := range ifaces {
		// Skip loopback interfaces
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		status := "Down"
		if iface.Flags&net.FlagUp != 0 {
			status = "Up"
		}

		// Get IP addresses and subnet mask for this interface
		addrs, err := iface.Addrs()
		if err != nil || len(addrs) == 0 {
			continue
		}

		// Take the first non-loopback IPv4 address
		for _, addr := range addrs {
			var ip net.IP
			var subnet *net.IPNet

			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
				subnet = v
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil || ip.IsLoopback() {
				continue
			}

			// Only include IPv4 for interface list, IPv6 is shown in host IPs
			if ip.To4() != nil {
				subnetMask := ""
				if subnet != nil {
					subnetMask = subnet.Mask.String()
				}

				interfaces = append(interfaces, NetworkInterface{
					Name:       iface.Name,
					Status:     status,
					IPAddress:  ip.String(),
					SubnetMask: subnetMask,
					MACAddress: iface.HardwareAddr.String(),
				})
				break // Only one IPv4 per interface in the list
			}
		}
	}

	return interfaces
}
