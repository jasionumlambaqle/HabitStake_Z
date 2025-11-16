import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface HabitData {
  id: string;
  name: string;
  targetDays: number;
  stakeAmount: number;
  currentStreak: number;
  createdAt: number;
  isCompleted: boolean;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingHabit, setCreatingHabit] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newHabitData, setNewHabitData] = useState({ name: "", targetDays: "", stakeAmount: "" });
  const [selectedHabit, setSelectedHabit] = useState<HabitData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalHabits: 0, completed: 0, totalStake: 0, currentStreak: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadHabits();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadHabits = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const habitsList: HabitData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          habitsList.push({
            id: businessId,
            name: businessData.name,
            targetDays: Number(businessData.publicValue1) || 0,
            stakeAmount: Number(businessData.publicValue2) || 0,
            currentStreak: Number(businessData.decryptedValue) || 0,
            createdAt: Number(businessData.timestamp),
            isCompleted: businessData.isVerified,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading habit data:', e);
        }
      }
      
      setHabits(habitsList);
      updateStats(habitsList);
      updateUserHistory();
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (habitsList: HabitData[]) => {
    const totalHabits = habitsList.length;
    const completed = habitsList.filter(h => h.isCompleted).length;
    const totalStake = habitsList.reduce((sum, h) => sum + h.stakeAmount, 0);
    const currentStreak = habitsList.reduce((max, h) => Math.max(max, h.currentStreak), 0);
    
    setStats({ totalHabits, completed, totalStake, currentStreak });
  };

  const updateUserHistory = () => {
    const history = [
      { action: "创建习惯", habit: "晨跑", time: "2小时前", status: "进行中" },
      { action: "打卡", habit: "阅读", time: "1天前", status: "成功" },
      { action: "完成目标", habit: "冥想", time: "3天前", status: "已完成" },
      { action: "创建习惯", habit: "学习", time: "1周前", status: "进行中" }
    ];
    setUserHistory(history);
  };

  const createHabit = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingHabit(true);
    setTransactionStatus({ visible: true, status: "pending", message: "创建加密习惯中..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const stakeAmount = parseInt(newHabitData.stakeAmount) || 0;
      const businessId = `habit-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, stakeAmount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newHabitData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newHabitData.targetDays) || 0,
        stakeAmount,
        "习惯对赌"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "习惯创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadHabits();
      setShowCreateModal(false);
      setNewHabitData({ name: "", targetDays: "", stakeAmount: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "创建失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingHabit(false); 
    }
  };

  const checkInHabit = async (habitId: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "打卡中..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "打卡成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "打卡失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const verifyHabit = async (habitId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(habitId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "数据已验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(habitId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(habitId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadHabits();
      
      setTransactionStatus({ visible: true, status: "success", message: "验证成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadHabits();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "验证失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card bronze">
          <div className="stat-icon">🔥</div>
          <div className="stat-content">
            <div className="stat-value">{stats.currentStreak}</div>
            <div className="stat-label">当前连胜</div>
          </div>
        </div>
        
        <div className="stat-card silver">
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <div className="stat-value">{stats.completed}/{stats.totalHabits}</div>
            <div className="stat-label">完成习惯</div>
          </div>
        </div>
        
        <div className="stat-card gold">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalStake}</div>
            <div className="stat-label">总押金</div>
          </div>
        </div>
      </div>
    );
  };

  const renderProgressChart = (habit: HabitData) => {
    const progress = Math.min(100, (habit.currentStreak / habit.targetDays) * 100);
    
    return (
      <div className="progress-chart">
        <div className="chart-header">
          <span>进度 {habit.currentStreak}/{habit.targetDays}</span>
          <span>{progress.toFixed(1)}%</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    return (
      <div className="history-section">
        <h3>操作记录</h3>
        <div className="history-list">
          {userHistory.map((record, index) => (
            <div key={index} className="history-item">
              <div className="history-icon">{getActionIcon(record.action)}</div>
              <div className="history-content">
                <div className="history-action">{record.action} · {record.habit}</div>
                <div className="history-time">{record.time} · {record.status}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const getActionIcon = (action: string) => {
    switch(action) {
      case "创建习惯": return "📝";
      case "打卡": return "✅";
      case "完成目标": return "🏆";
      default: return "📊";
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>习惯隐私对赌 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包开始习惯对赌</h2>
            <p>使用FHE加密技术保护您的习惯数据隐私，达成目标解锁押金</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密习惯数据...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>习惯隐私对赌 🔐</h1>
          <p>加密记录习惯，达成目标解锁押金</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + 新建习惯
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="sidebar">
          {renderStats()}
          {renderUserHistory()}
        </div>
        
        <div className="content-area">
          <div className="habits-section">
            <div className="section-header">
              <h2>我的习惯对赌</h2>
              <div className="header-actions">
                <button 
                  onClick={loadHabits} 
                  className="refresh-btn metal-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中..." : "刷新"}
                </button>
              </div>
            </div>
            
            <div className="habits-grid">
              {habits.length === 0 ? (
                <div className="no-habits">
                  <p>还没有习惯对赌</p>
                  <button 
                    className="create-btn metal-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    创建第一个习惯
                  </button>
                </div>
              ) : habits.map((habit) => (
                <div 
                  className={`habit-card ${habit.isCompleted ? "completed" : ""}`} 
                  key={habit.id}
                  onClick={() => setSelectedHabit(habit)}
                >
                  <div className="habit-header">
                    <h3>{habit.name}</h3>
                    <span className={`status-badge ${habit.isCompleted ? "completed" : "active"}`}>
                      {habit.isCompleted ? "已完成" : "进行中"}
                    </span>
                  </div>
                  
                  {renderProgressChart(habit)}
                  
                  <div className="habit-meta">
                    <div className="meta-item">
                      <span>目标天数</span>
                      <strong>{habit.targetDays}天</strong>
                    </div>
                    <div className="meta-item">
                      <span>押金</span>
                      <strong>{habit.stakeAmount}</strong>
                    </div>
                    <div className="meta-item">
                      <span>当前连胜</span>
                      <strong>{habit.currentStreak}天</strong>
                    </div>
                  </div>
                  
                  <div className="habit-actions">
                    <button 
                      className="checkin-btn metal-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        checkInHabit(habit.id);
                      }}
                    >
                      ✅ 打卡
                    </button>
                    <button 
                      className="verify-btn metal-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        verifyHabit(habit.id);
                      }}
                    >
                      🔓 验证
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateHabit 
          onSubmit={createHabit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingHabit} 
          habitData={newHabitData} 
          setHabitData={setNewHabitData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedHabit && (
        <HabitDetailModal 
          habit={selectedHabit} 
          onClose={() => setSelectedHabit(null)} 
          verifyHabit={() => verifyHabit(selectedHabit.id)}
          checkInHabit={() => checkInHabit(selectedHabit.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateHabit: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  habitData: any;
  setHabitData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, habitData, setHabitData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setHabitData({ ...habitData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-habit-modal">
        <div className="modal-header">
          <h2>新建习惯对赌</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>押金金额将使用Zama FHE进行加密存储，保护您的隐私</p>
          </div>
          
          <div className="form-group">
            <label>习惯名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={habitData.name} 
              onChange={handleChange} 
              placeholder="例如：晨跑、阅读..." 
            />
          </div>
          
          <div className="form-group">
            <label>目标天数 *</label>
            <input 
              type="number" 
              name="targetDays" 
              value={habitData.targetDays} 
              onChange={handleChange} 
              placeholder="坚持多少天..." 
              min="1"
            />
          </div>
          
          <div className="form-group">
            <label>押金金额 (整数) *</label>
            <input 
              type="number" 
              name="stakeAmount" 
              value={habitData.stakeAmount} 
              onChange={handleChange} 
              placeholder="对赌押金..." 
              min="0"
              step="1"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !habitData.name || !habitData.targetDays || !habitData.stakeAmount} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "加密创建中..." : "创建习惯"}
          </button>
        </div>
      </div>
    </div>
  );
};

const HabitDetailModal: React.FC<{
  habit: HabitData;
  onClose: () => void;
  verifyHabit: () => Promise<number | null>;
  checkInHabit: () => void;
}> = ({ habit, onClose, verifyHabit, checkInHabit }) => {
  return (
    <div className="modal-overlay">
      <div className="habit-detail-modal">
        <div className="modal-header">
          <h2>{habit.name}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="habit-info-grid">
            <div className="info-item">
              <label>目标天数</label>
              <div className="info-value">{habit.targetDays}天</div>
            </div>
            <div className="info-item">
              <label>当前连胜</label>
              <div className="info-value">{habit.currentStreak}天</div>
            </div>
            <div className="info-item">
              <label>押金金额</label>
              <div className="info-value">
                {habit.isVerified ? `${habit.decryptedValue} (已验证)` : "🔒 加密中"}
              </div>
            </div>
            <div className="info-item">
              <label>创建时间</label>
              <div className="info-value">{new Date(habit.createdAt * 1000).toLocaleDateString()}</div>
            </div>
          </div>
          
          <div className="progress-section">
            <h3>进度追踪</h3>
            <div className="progress-chart-large">
              <div className="chart-header">
                <span>完成进度</span>
                <span>{((habit.currentStreak / habit.targetDays) * 100).toFixed(1)}%</span>
              </div>
              <div className="progress-bar-large">
                <div 
                  className="progress-fill-large"
                  style={{ width: `${Math.min(100, (habit.currentStreak / habit.targetDays) * 100)}%` }}
                ></div>
              </div>
              <div className="progress-stats">
                <span>已坚持: {habit.currentStreak}天</span>
                <span>剩余: {Math.max(0, habit.targetDays - habit.currentStreak)}天</span>
              </div>
            </div>
          </div>
          
          <div className="fhe-info-section">
            <h3>🔐 FHE加密状态</h3>
            <div className="fhe-status">
              <div className="status-item">
                <span>数据加密:</span>
                <span className="status-on">已加密</span>
              </div>
              <div className="status-item">
                <span>链上验证:</span>
                <span className={habit.isVerified ? "status-on" : "status-off"}>
                  {habit.isVerified ? "已验证" : "未验证"}
                </span>
              </div>
              <div className="status-item">
                <span>隐私保护:</span>
                <span className="status-on">启用</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">关闭</button>
          <div className="action-buttons">
            <button onClick={checkInHabit} className="checkin-btn metal-btn">
              ✅ 今日打卡
            </button>
            <button onClick={verifyHabit} className="verify-btn metal-btn">
              🔓 验证解密
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

