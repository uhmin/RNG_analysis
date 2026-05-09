class RNG {
    constructor() {
        this.bitBuffer = [];
    }

    addBit(bit) {
        this.bitBuffer.push(bit & 1);
        if (this.bitBuffer.length > 1024) this.bitBuffer.shift();
    }

    getBufferSize() {
        return this.bitBuffer.length;
    }

    next() {
        if (this.bitBuffer.length < 16) return null;
        let value = 0;
        for (let i = 0; i < 16; i++) {
            value = (value << 1) | this.bitBuffer.shift();
        }
        return value;
    }
}

class Statistics {
    constructor(windowSize = 32) {
        this.values = [];
        this.windowSize = windowSize;
        this.totalSum = 0;
        this.totalCount = 0;
        this.distribution = new Array(16).fill(0); // 16 bins for 4-bit numbers (0-15)
    }

    add(value) {
        // Count number of 1s in 16-bit value
        let ones = 0;
        for (let i = 0; i < 16; i++) {
            if ((value & (1 << i)) !== 0) ones++;
        }

        this.values.push(ones);
        this.totalSum += ones;
        this.totalCount++;

        // Update distribution with decay to emphasize current bias
        const decayFactor = 0.99; // 1.0に近いほど減衰が遅く、小さいほど速い
        for (let i = 0; i < this.distribution.length; i++) {
            this.distribution[i] *= decayFactor;
        }

        // Split 16-bit into four 4-bit chunks and count
        this.distribution[value & 0xF] += 1;
        this.distribution[(value >> 4) & 0xF] += 1;
        this.distribution[(value >> 8) & 0xF] += 1;
        this.distribution[(value >> 12) & 0xF] += 1;

        // Keep window size fixed for recent values
        if (this.values.length > this.windowSize) {
            this.values.shift();
        }
    }

    getMean() {
        if (this.totalCount === 0) return 0;
        return this.totalSum / this.totalCount;
    }

    getWindowMean() {
        if (this.values.length === 0) return 0;
        const sum = this.values.reduce((a, b) => a + b, 0);
        return sum / this.values.length;
    }

    getWindowStdDev() { // Label is Std Dev, but calculates Variance as requested
        if (this.values.length < 2) return 0;
        const mean = this.getWindowMean();
        const variance = this.values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.values.length;
        return variance;
    }

    getDistribution() {
        return this.distribution;
    }

    getShannonEntropy() {
        const sum = this.distribution.reduce((a, b) => a + b, 0);
        if (sum === 0) return 0;

        let entropy = 0;
        for (let i = 0; i < this.distribution.length; i++) {
            const p = this.distribution[i] / sum;
            if (p > 0) {
                entropy -= p * Math.log2(p);
            }
        }
        return entropy;
    }
}

class App {
    constructor() {
        this.rng = new RNG();
        this.stats = new Statistics(32);
        this.isRunning = false;
        this.intervalId = null;
        this.speed = 10;
        this.maxDataPoints = 50; // Max points to show on x-axis (Mobile optimized)

        this.obsMinVariance = Infinity;
        this.obsMaxVariance = 0;
        this.obsMinEntropy = Infinity;

        // Histograms for Variance and Entropy
        this.varHistData = new Array(40).fill(0); // 0.0 to 8.0, step 0.2
        this.entropyHistData = new Array(50).fill(0); // 3.95 to 4.0, step 0.001

        this.motionHandler = this.handleMotion.bind(this);

        this.initElements();
        this.initCharts();
        this.attachListeners();
    }

    initElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.speedRange = document.getElementById('speedRange');
        this.speedValue = document.getElementById('speedValue');

        this.elCurrent = document.getElementById('currentValue');
        this.elCount = document.getElementById('countValue');
        this.elMean = document.getElementById('meanValue');
        this.elStdDev = document.getElementById('stdDevValue');
        this.elEntropy = document.getElementById('entropyValue');
        this.elVarMinMax = document.getElementById('varianceMinMax');
        this.elEntropyMin = document.getElementById('entropyMin');
    }

    initCharts() {
        // Main Chart (Line)
        const ctxMain = document.getElementById('mainChart').getContext('2d');
        this.mainChart = new Chart(ctxMain, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Raw Value',
                        borderColor: '#38bdf8', // Accent color
                        backgroundColor: 'rgba(56, 189, 248, 0.1)',
                        data: [],
                        tension: 0.4,
                        pointRadius: 2
                    },
                    {
                        label: 'Moving Avg (Window)',
                        borderColor: '#22c55e', // Success color
                        borderDash: [5, 5],
                        data: [],
                        tension: 0.4,
                        pointRadius: 0
                    },
                    {
                        label: 'Variance (Window)',
                        borderColor: '#f472b6', // Pinkish
                        data: [],
                        tension: 0.4,
                        pointRadius: 0,
                        yAxisID: 'y1'
                    },
                    {
                        label: 'Shannon Entropy',
                        borderColor: '#eab308', // Yellow
                        data: [],
                        tension: 0.4,
                        pointRadius: 0,
                        yAxisID: 'y2'
                    },
                    {
                        label: 'Max Entropy (4.0)',
                        borderColor: 'rgba(234, 179, 8, 0.4)', // 薄い黄色
                        borderDash: [5, 5],
                        data: [],
                        tension: 0,
                        pointRadius: 0,
                        borderWidth: 1,
                        yAxisID: 'y2'
                    },
                    {
                        label: 'Expected Mean (8.0)',
                        borderColor: 'rgba(34, 197, 94, 0.4)', // 薄い緑色
                        borderDash: [5, 5],
                        data: [],
                        tension: 0,
                        pointRadius: 0,
                        borderWidth: 1
                    },
                    {
                        label: 'Expected Variance (4.0)',
                        borderColor: 'rgba(244, 114, 182, 0.4)', // 薄いピンク色
                        borderDash: [5, 5],
                        data: [],
                        tension: 0,
                        pointRadius: 0,
                        borderWidth: 1,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // Disable animation for performance
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        display: false // Hide x-axis labels for cleaner look
                    },
                    y: {
                        min: 0,
                        max: 16,
                        grid: {
                            color: '#334155'
                        },
                        ticks: {
                            color: '#94a3b8'
                        }
                    },
                    y1: {
                        position: 'right',
                        min: 0,
                        max: 8,
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            color: '#f472b6'
                        }
                    },
                    y2: {
                        position: 'right',
                        min: 3.95,
                        max: 4.0, // 16bins max entropy is log2(16) = 4.0
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            color: '#eab308'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#f8fafc'
                        }
                    }
                }
            }
        });

        // Distribution Chart (Bar)
        const ctxDist = document.getElementById('distributionChart').getContext('2d');
        this.distChart = new Chart(ctxDist, {
            type: 'bar',
            data: {
                labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
                datasets: [{
                    label: 'Frequency',
                    data: new Array(16).fill(0),
                    backgroundColor: '#818cf8',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 0 // Disable animation for performance
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 40, // 4 items per tick, decay 0.995, sum converges to ~800. avg 50 per bin.
                        grid: {
                            color: '#334155'
                        },
                        ticks: {
                            color: '#94a3b8'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: {
                                size: 10
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });

        // Variance Histogram Chart
        const ctxVarHist = document.getElementById('varHistChart').getContext('2d');
        this.varHistChart = new Chart(ctxVarHist, {
            type: 'bar',
            data: {
                labels: Array.from({length: 40}, (_, i) => (i * 0.2).toFixed(1)),
                datasets: [{
                    label: 'Variance Freq',
                    data: this.varHistData,
                    backgroundColor: '#f472b6',
                    borderRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                scales: {
                    x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
                },
                plugins: { legend: { display: false }, title: { display: true, text: 'Variance Histogram', color: '#f8fafc' } }
            }
        });

        // Entropy Histogram Chart
        const ctxEntropyHist = document.getElementById('entropyHistChart').getContext('2d');
        this.entropyHistChart = new Chart(ctxEntropyHist, {
            type: 'bar',
            data: {
                labels: Array.from({length: 50}, (_, i) => (3.95 + i * 0.001).toFixed(3)),
                datasets: [{
                    label: 'Entropy Freq',
                    data: this.entropyHistData,
                    backgroundColor: '#eab308',
                    borderRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                scales: {
                    x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
                },
                plugins: { legend: { display: false }, title: { display: true, text: 'Entropy Histogram', color: '#f8fafc' } }
            }
        });
    }

    attachListeners() {
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.speedRange.addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            this.speedValue.textContent = this.speed;
            if (this.isRunning) {
                this.stop();
                this.start();
            }
        });
    }

    start() {
        if (this.isRunning) return;

        // Request permission for iOS 13+
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        this.activate();
                    } else {
                        alert('Accelerometer permission denied.');
                    }
                })
                .catch(err => {
                    console.error(err);
                    alert('Error requesting accelerometer permission.');
                });
        } else {
            this.activate();
        }
    }

    activate() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startBtn.disabled = true;
        this.stopBtn.disabled = false;

        window.addEventListener('devicemotion', this.motionHandler);
        this.intervalId = setInterval(() => this.tick(), this.speed);
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        
        window.removeEventListener('devicemotion', this.motionHandler);
        clearInterval(this.intervalId);
    }

    handleMotion(event) {
        const acc = event.accelerationIncludingGravity;
        if (!acc) return;

        // Extract LSB from X, Y, Z
        const xBit = Math.floor(Math.abs(acc.x || 0) * 1000000) & 1;
        const yBit = Math.floor(Math.abs(acc.y || 0) * 1000000) & 1;
        const zBit = Math.floor(Math.abs(acc.z || 0) * 1000000) & 1;

        this.rng.addBit(xBit);
        this.rng.addBit(yBit);
        this.rng.addBit(zBit);
    }

    reset() {
        this.stop();
        this.stats = new Statistics(32);
        this.rng = new RNG(); // Clear bit buffer
        this.obsMinVariance = Infinity;
        this.obsMaxVariance = 0;
        this.obsMinEntropy = Infinity;
        this.updateUI(0); // Reset UI

        // Reset Charts
        this.mainChart.data.labels = [];
        this.mainChart.data.datasets.forEach(dataset => dataset.data = []);
        this.mainChart.update();

        this.distChart.data.datasets[0].data = new Array(16).fill(0);
        this.distChart.update();

        this.varHistData = new Array(40).fill(0);
        this.varHistChart.data.datasets[0].data = this.varHistData;
        this.varHistChart.update();

        this.entropyHistData = new Array(50).fill(0);
        this.entropyHistChart.data.datasets[0].data = this.entropyHistData;
        this.entropyHistChart.update();
    }

    tick() {
        const value = this.rng.next();
        if (value === null) {
            // Not enough bits yet
            this.elCurrent.textContent = `Buffering (${this.rng.getBufferSize()}/16)`;
            return;
        }
        this.stats.add(value);
        const ones = this.stats.values[this.stats.values.length - 1];
        this.updateUI(ones);
        this.updateCharts(ones);
    }

    updateUI(ones) {
        this.elCurrent.textContent = ones.toString();
        this.elCount.textContent = this.stats.totalCount;
        this.elMean.textContent = this.stats.getMean().toFixed(4);

        const currentVar = this.stats.getWindowStdDev();
        const currentEntropy = this.stats.getShannonEntropy();

        this.elStdDev.textContent = currentVar.toFixed(4); // Shows Variance
        this.elEntropy.textContent = currentEntropy.toFixed(4);

        // Update observations only after 200 trials to allow the distribution to stabilize
        if (this.stats.totalCount >= 1000) {
            if (currentVar < this.obsMinVariance) this.obsMinVariance = currentVar;
            if (currentVar > this.obsMaxVariance) this.obsMaxVariance = currentVar;
            if (currentEntropy < this.obsMinEntropy) this.obsMinEntropy = currentEntropy;

            this.elVarMinMax.textContent = `Min: ${this.obsMinVariance.toFixed(4)} / Max: ${this.obsMaxVariance.toFixed(4)}`;
            this.elEntropyMin.textContent = `Min: ${this.obsMinEntropy.toFixed(4)}`;
        } else {
            this.elVarMinMax.textContent = `Min: - / Max: -`;
            this.elEntropyMin.textContent = `Min: -`;
        }
    }

    updateCharts(ones) {
        // Update Main Chart
        const label = this.stats.totalCount;
        this.mainChart.data.labels.push(label);
        this.mainChart.data.datasets[0].data.push(ones);
        this.mainChart.data.datasets[1].data.push(this.stats.getWindowMean());
        this.mainChart.data.datasets[2].data.push(this.stats.getWindowStdDev());
        this.mainChart.data.datasets[3].data.push(this.stats.getShannonEntropy());
        this.mainChart.data.datasets[4].data.push(4.0); // log2(16) = 4
        this.mainChart.data.datasets[5].data.push(8.0); // Expected Mean
        this.mainChart.data.datasets[6].data.push(4.0); // Expected Variance

        // Remove old data points to keep performance high
        if (this.mainChart.data.labels.length > this.maxDataPoints) {
            this.mainChart.data.labels.shift();
            this.mainChart.data.datasets.forEach(d => d.data.shift());
        }
        this.mainChart.update('none'); // 'none' mode for performance

        // Update Distribution Chart
        this.distChart.data.datasets[0].data = this.stats.getDistribution();
        this.distChart.update('none');

        // Update Variance & Entropy Histograms (After 1000 trials)
        if (this.stats.totalCount >= 1000) {
            const currentVar = this.stats.getWindowStdDev();
            const currentEntropy = this.stats.getShannonEntropy();

            // Bin variance: 0 to 8, step 0.2
            let varBin = Math.floor(currentVar / 0.2);
            if (varBin < 0) varBin = 0;
            if (varBin >= 40) varBin = 39;
            this.varHistData[varBin]++;
            this.varHistChart.update('none');

            // Bin entropy: 3.95 to 4.0, step 0.001
            let entBin = Math.floor((currentEntropy - 3.95) / 0.001);
            if (entBin < 0) entBin = 0;
            if (entBin >= 50) entBin = 49;
            this.entropyHistData[entBin]++;
            this.entropyHistChart.update('none');
        }
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
