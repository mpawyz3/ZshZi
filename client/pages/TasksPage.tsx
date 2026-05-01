import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Tabs, TabsContent } from "../components/ui/tabs";
import {
  CheckSquare,
  PlusCircle,
  MessageSquare,
  Filter,
  Grid3x3,
  List,
  Search,
  AlertCircle,
  Tag,
} from "lucide-react";
import { supabase, Task as TaskType, Complaint, TaskResponse, TaskProposal, TodoListItem, UserProfile } from "../lib/supabase";
import { toast } from "../hooks/use-toast";
import { FileAttachment } from "../components/FileUploadZone";
import AttachmentList from "../components/AttachmentList";
import { useFileUpload } from "../hooks/useFileUpload";
import TaskResponseModal from "../components/TaskResponseModal";
import ManagerProposalReview from "../components/ManagerProposalReview";
import ServiceProviderProposalReview from "../components/ServiceProviderProposalReview";
import TodoItem from "../components/TodoItem";
import TaskChat from "../components/TaskChat";

// Import new sub-components
import TasksPageHeader from "./tasks/components/TasksPageHeader";
import DashboardStats from "./tasks/components/DashboardStats";
import TabsNavigation from "./tasks/components/TabsNavigation";
import NewTaskTab from "./tasks/components/NewTaskTab/NewTaskTab";
import StatusIcon from "./tasks/components/StatusIcon";
import { getPriorityColor, getStatusColor, getStatusLabel } from "./tasks/utils/taskDisplay";

interface TaskUI extends TaskType {
  category?: "operations" | "service" | "training" | "maintenance";
  assignedTo?: string;
  dueDate?: string;
  createdAt?: string;
  estimatedTime?: string;
  checklist?: string[];
}

interface Message {
  id: string;
  taskId: string;
  author: string;
  content: string;
  timestamp: string;
  attachments?: string[];
}

const TasksPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { linkToTask, getTaskAttachments, getComplaintAttachments } = useFileUpload();

  // Determine active tab from URL path
  const getTabFromPath = () => {
    if (location.pathname.includes("/tasks/list")) return "todo-list";
    if (location.pathname.includes("/tasks/chat")) return "live-chat";
    return "new-task";
  };

  const [activeTab, setActiveTab] = useState(getTabFromPath());
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [taskAttachments, setTaskAttachments] = useState<Map<string, FileAttachment[]>>(new Map());

  // Form state
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    priority: "",
    category: "",
    assignmentType: "",
    assignee: "",
    dueDate: "",
    estimatedTime: "",
    paymentTerms: "",
    budget: "",
  });

  // File attachments state
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);

  // Data state
  const [tasks, setTasks] = useState<TaskUI[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [userRole, setUserRole] = useState<"guest" | "manager" | "service_provider" | null>(null);
  const [internalStaff, setInternalStaff] = useState<any[]>([]);
  const [externalVendors, setExternalVendors] = useState<any[]>([]);

  // Task responses and proposals
  const [taskResponses, setTaskResponses] = useState<TaskResponse[]>([]);
  const [taskProposals, setTaskProposals] = useState<TaskProposal[]>([]);
  const [todoItems, setTodoItems] = useState<TodoListItem[]>([]);

  // Attachments state
  const [complaintAttachments, setComplaintAttachments] = useState<Map<string, FileAttachment[]>>(new Map());
  const [todoAttachments, setTodoAttachments] = useState<Map<string, FileAttachment[]>>(new Map());

  // Modal states
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [selectedTaskForResponse, setSelectedTaskForResponse] = useState<TaskUI | null>(null);

  // Sync URL with tab changes
  useEffect(() => {
    const newTab = getTabFromPath();
    setActiveTab(newTab);
    // Reset filter when switching tabs
    setFilterStatus("all");
  }, [location.pathname]);

  // Load todos whenever currentUserProfile changes
  useEffect(() => {
    if (currentUserProfile && userRole === "service_provider") {
      supabase
        .from("todo_list")
        .select("*")
        .eq("provider_id", currentUserProfile.id)
        .order("created_at", { ascending: false })
        .then(({ data }) => setTodoItems(data || []));
    }
  }, [currentUserProfile, userRole]);

  // Load attachments for all todos whenever todoItems change
  useEffect(() => {
    const loadTodoAttachments = async () => {
      if (todoItems && todoItems.length > 0) {
        const todoAttachmentsMap = new Map<string, FileAttachment[]>();

        for (const todo of todoItems) {
          const attachments = await getTaskAttachments(todo.task_id);
          todoAttachmentsMap.set(todo.id, attachments as FileAttachment[]);
        }

        setTodoAttachments(todoAttachmentsMap);
      }
    };

    loadTodoAttachments();
  }, [todoItems, getTaskAttachments]);

  // Subscribe to real-time updates for task responses, proposals, and todos
  useEffect(() => {
    // Subscribe to task responses
    const responsesSubscription = supabase
      .channel("task_responses")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_responses",
        },
        () => {
          // Reload task responses when any change occurs
          supabase
            .from("task_responses")
            .select("*")
            .order("created_at", { ascending: false })
            .then(({ data }) => setTaskResponses(data || []));
        }
      )
      .subscribe();

    // Subscribe to task proposals
    const proposalsSubscription = supabase
      .channel("task_proposals")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_proposals",
        },
        () => {
          // Reload task proposals when any change occurs
          supabase
            .from("task_proposals")
            .select("*")
            .order("created_at", { ascending: false })
            .then(({ data }) => setTaskProposals(data || []));
        }
      )
      .subscribe();

    // Subscribe to todo list changes
    let todosSubscription: any = null;
    if (currentUserProfile && userRole === "service_provider") {
      todosSubscription = supabase
        .channel(`todo_list_${currentUserProfile.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "todo_list",
            filter: `provider_id=eq.${currentUserProfile.id}`,
          },
          () => {
            // Reload todos when any change occurs
            supabase
              .from("todo_list")
              .select("*")
              .eq("provider_id", currentUserProfile.id)
              .order("created_at", { ascending: false })
              .then(({ data }) => setTodoItems(data || []));
          }
        )
        .subscribe();
    }

    return () => {
      responsesSubscription?.unsubscribe();
      proposalsSubscription?.unsubscribe();
      todosSubscription?.unsubscribe();
    };
  }, [currentUserProfile, userRole]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "new-task") navigate("/tasks/new");
    else if (tab === "todo-list") navigate("/tasks/list");
    else if (tab === "live-chat") navigate("/tasks/chat");
  };

  // Load user, complaints, tasks, and assignees from Supabase
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);

        // Get current user
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setCurrentUser(user);

        // Get current user's profile and role
        if (user) {
          const { data: profileData } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single();

          if (profileData) {
            setCurrentUserProfile(profileData);
            setUserRole(profileData.role as "guest" | "manager" | "service_provider");
          }
        }

        // Load internal staff (service_category = 'internal')
        const { data: internalData, error: internalError } = await supabase
          .from("user_profiles")
          .select("id, email, first_name, last_name, service_type, role")
          .eq("service_category", "internal");

        if (internalError) throw internalError;
        setInternalStaff(internalData || []);

        // Load external vendors (service_category = 'external')
        const { data: externalData, error: externalError } = await supabase
          .from("user_profiles")
          .select("id, email, first_name, last_name, service_type, role")
          .eq("service_category", "external");

        if (externalError) throw externalError;
        setExternalVendors(externalData || []);

        // Load complaints (for managers to convert to tasks)
        const { data: complaintsData, error: complaintsError } = await supabase
          .from("complaints")
          .select("*")
          .eq("status", "open")
          .order("created_at", { ascending: false });

        if (complaintsError) throw complaintsError;
        setComplaints(complaintsData || []);

        // Load attachments for all complaints
        if (complaintsData && complaintsData.length > 0) {
          const complaintAttachmentsMap = new Map<string, FileAttachment[]>();

          for (const complaint of complaintsData) {
            const attachments = await getComplaintAttachments(complaint.id);
            complaintAttachmentsMap.set(complaint.id, attachments as FileAttachment[]);
          }

          setComplaintAttachments(complaintAttachmentsMap);
        }

        // Load tasks
        const { data: tasksData, error: tasksError } = await supabase
          .from("tasks")
          .select("*")
          .order("created_at", { ascending: false });

        if (tasksError) throw tasksError;
        setTasks(tasksData || []);

        // Load task responses
        const { data: responsesData } = await supabase
          .from("task_responses")
          .select("*")
          .order("created_at", { ascending: false });
        setTaskResponses(responsesData || []);

        // Load task proposals
        const { data: proposalsData } = await supabase
          .from("task_proposals")
          .select("*")
          .order("created_at", { ascending: false });
        setTaskProposals(proposalsData || []);

        // Load todo list items (for service providers)
        if (user && profileData?.role === "service_provider") {
          const { data: todosData } = await supabase
            .from("todo_list")
            .select("*")
            .eq("provider_id", profileData.id)
            .order("created_at", { ascending: false });
          setTodoItems(todosData || []);
        }

        // Load attachments for all tasks
        if (tasksData && tasksData.length > 0) {
          const attachmentsMap = new Map<string, FileAttachment[]>();

          for (const task of tasksData) {
            const attachments = await getTaskAttachments(task.id);
            attachmentsMap.set(task.id, attachments as FileAttachment[]);
          }

          setTaskAttachments(attachmentsMap);
        }
      } catch (error) {
        console.error("Error loading data:", error);
        toast({
          title: "Error",
          description: "Failed to load tasks and complaints",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [getTaskAttachments, getComplaintAttachments]);

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter =
      filterStatus === "all" || task.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  // Helper function: Get tasks assigned to current service provider that have no response yet
  const getUnrespondedAssignedTasks = () => {
    if (!currentUserProfile || userRole !== "service_provider") return [];

    return tasks.filter((task) => {
      // Task must be assigned to current user
      const isAssignedToMe = task.assigned_to === currentUserProfile.id;
      if (!isAssignedToMe) return false;

      // Task must NOT have a response from current user
      const hasResponse = taskResponses.some(
        (response) =>
          response.task_id === task.id &&
          response.provider_id === currentUserProfile.id
      );

      return !hasResponse;
    });
  };

  // Helper function: Check if a task has a response from current user
  const getTaskResponse = (taskId: string) => {
    if (!currentUserProfile) return null;
    return taskResponses.find(
      (response) =>
        response.task_id === taskId &&
        response.provider_id === currentUserProfile.id
    );
  };

  // Helper function: Get pending proposals for current service provider
  const getPendingProposalsForProvider = () => {
    if (!currentUserProfile || userRole !== "service_provider") return [];

    return taskProposals.filter((proposal) => {
      // Only proposals sent to this provider
      const isForMe = proposal.provider_id === currentUserProfile.id;
      // Only pending or counter-proposed (active negotiation)
      const isActive = proposal.status === "pending" || proposal.status === "counter_proposed";
      return isForMe && isActive;
    });
  };

  // Calculate dashboard stats
  const stats = {
    open: tasks.filter((t) => t.status !== "completed").length,
    urgent: tasks.filter((t) => t.priority === "urgent").length,
    completedToday: tasks.filter(
      (t) =>
        t.status === "completed" &&
        new Date(t.created_at).toDateString() === new Date().toDateString()
    ).length,
    awaitingChat: messages.filter(
      (m) => {
        const task = tasks.find((t) => t.id === m.taskId);
        return task && task.status !== "completed";
      }
    ).length,
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateTask = async () => {
    if (!formData.title || !formData.priority || !formData.assignmentType || !formData.assignee) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Find the assigned user ID from the selected assignee
      const assignees = formData.assignmentType === "internal" ? internalStaff : externalVendors;
      const selectedAssignee = assignees.find(
        (a) => `${a.first_name} ${a.last_name} - ${a.service_type}` === formData.assignee ||
               `${a.email}` === formData.assignee
      );

      // Create task in Supabase (without attachments - we'll link them separately)
      const taskData = {
        complaint_id: selectedComplaint?.id || null,
        title: formData.title,
        description: formData.description,
        priority: formData.priority as "low" | "medium" | "high" | "urgent",
        category: (formData.category as "operations" | "service" | "training" | "maintenance") || null,
        status: "todo",
        assigned_to: selectedAssignee?.id || null,
        assignee_name: formData.assignee,
        assigned_category: formData.assignmentType as "internal" | "external",
        due_date: formData.dueDate || null,
        estimated_time: formData.estimatedTime || null,
        payment_terms: formData.paymentTerms || null,
        is_from_complaint: selectedComplaint !== null,
        budget: formData.budget ? parseFloat(formData.budget) : null,
        created_by: currentUser?.id,
      };

      const { data: createdTask, error: taskError } = await supabase
        .from("tasks")
        .insert([taskData])
        .select()
        .single();

      if (taskError) throw taskError;

      // Link attachments to the task
      if (createdTask && fileAttachments.length > 0) {
        for (const attachment of fileAttachments) {
          const success = await linkToTask(attachment.attachmentId, createdTask.id);
          if (!success) {
            console.warn(`Failed to link attachment ${attachment.attachmentId} to task`);
          }
        }
      }

      toast({
        title: "Success",
        description: `Task created and assigned to ${formData.assignee}!`,
      });

      // Reload tasks
      const { data: tasksData } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      setTasks(tasksData || []);

      // Load attachments for the newly created task
      const newAttachments = await getTaskAttachments(createdTask.id);
      setTaskAttachments((prev) => {
        const updated = new Map(prev);
        updated.set(createdTask.id, newAttachments as FileAttachment[]);
        return updated;
      });

      // Reset form
      setFormData({
        title: "",
        description: "",
        priority: "",
        category: "",
        assignmentType: "",
        assignee: "",
        dueDate: "",
        estimatedTime: "",
        paymentTerms: "",
        budget: "",
      });
      setFileAttachments([]);
      setSelectedComplaint(null);
    } catch (error) {
      console.error("Error creating task:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create task",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectComplaint = async (complaint: Complaint) => {
    setSelectedComplaint(complaint);
    // Prefill form with complaint data
    setFormData((prev) => ({
      ...prev,
      title: `Address: ${complaint.complaint_type} - ${complaint.room_number}`,
      description: complaint.description,
      priority: complaint.priority as any,
    }));

    // Auto-populate attachments from complaint (from normalized table, not JSONB)
    try {
      const complaintAttachments = await getComplaintAttachments(complaint.id);
      if (complaintAttachments && complaintAttachments.length > 0) {
        setFileAttachments(complaintAttachments as FileAttachment[]);
      }
    } catch (error) {
      console.error("Error loading complaint attachments:", error);
    }
  };

  const handleAcceptComplaint = async (complaint: Complaint) => {
    setIsSubmitting(true);
    try {
      // 1. Update complaint status to acknowledged
      const { error: updateError } = await supabase
        .from("complaints")
        .update({ status: "acknowledged" })
        .eq("id", complaint.id);

      if (updateError) throw updateError;

      // 2. Create notification for the guest
      if (complaint.user_id) {
        const { error: notificationError } = await supabase
          .from("notifications")
          .insert([
            {
              user_id: complaint.user_id,
              complaint_id: complaint.id,
              type: "complaint_acknowledged",
              message: "Your complaint has been received. Help is on the way!",
              is_read: false,
            },
          ]);

        if (notificationError) {
          console.error("Failed to create notification:", notificationError);
        }
      }

      // 3. Select complaint and prefill form (now async)
      await handleSelectComplaint(complaint);

      // 4. Update local complaints list to remove this one
      setComplaints((prev) => prev.filter((c) => c.id !== complaint.id));

      toast({
        title: "Success",
        description: "Complaint acknowledged. Guest has been notified.",
      });

      // Scroll to form
      setTimeout(() => {
        const formElement = document.querySelector('[data-task-form]');
        if (formElement) {
          formElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    } catch (error) {
      console.error("Error accepting complaint:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to acknowledge complaint",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendMessage = () => {
    if (!chatMessage.trim() || !selectedTask) return;

    const newMessage: Message = {
      id: `MSG-${Date.now()}`,
      taskId: selectedTask,
      author: "Current User",
      content: chatMessage,
      timestamp: new Date().toISOString(),
    };

    setMessages([...messages, newMessage]);
    setChatMessage("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sheraton-cream to-background">
      <div className="container py-8">
        {/* Page Header */}
        <TasksPageHeader />

        {/* Dashboard Stats */}
        <DashboardStats stats={stats} />

        {/* Navigation Tabs */}
        <TabsNavigation activeTab={activeTab} onTabChange={handleTabChange} />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          {/* New Task Tab */}
          <NewTaskTab
            isLoading={isLoading}
            complaints={complaints}
            selectedComplaint={selectedComplaint}
            complaintAttachments={complaintAttachments}
            formData={formData}
            fileAttachments={fileAttachments}
            isSubmitting={isSubmitting}
            internalStaff={internalStaff}
            externalVendors={externalVendors}
            onSelectComplaint={handleSelectComplaint}
            onAcceptComplaint={handleAcceptComplaint}
            onFormChange={handleFormChange}
            onAddAttachments={(newAttachments) =>
              setFileAttachments((prev) => [...prev, ...newAttachments])
            }
            onRemoveAttachment={(id) =>
              setFileAttachments((prev) =>
                prev.filter((att) => att.id !== id)
              )
            }
            onCreateTask={handleCreateTask}
            onClearSelectedComplaint={() => setSelectedComplaint(null)}
          />

          {/* To Do List Tab */}
          <TabsContent value="todo-list" className="space-y-6">
            {userRole === "service_provider" ? (
              // Service Provider View - Show unresponded tasks and accepted tasks
              <>
                {/* SECTION 1: AWAITING YOUR RESPONSE */}
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <AlertCircle className="h-6 w-6 text-orange-500" />
                    <div>
                      <h2 className="text-2xl font-bold text-sheraton-navy">Awaiting Your Response</h2>
                      <p className="text-sm text-gray-600">Tasks assigned to you - accept, decline, or propose</p>
                    </div>
                  </div>

                  {/* Unresponded Tasks Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {getUnrespondedAssignedTasks().map((task) => (
                      <Card
                        key={task.id}
                        className="border-2 border-orange-200 bg-orange-50 hover:shadow-lg transition-shadow overflow-hidden"
                      >
                        <CardContent className="p-6">
                          {/* Header */}
                          <div className="flex items-start justify-between mb-4 pb-4 border-b border-orange-200">
                            <div className="flex items-start gap-3 flex-1">
                              <div className="p-2 bg-white rounded-lg flex-shrink-0">
                                <StatusIcon status={task.status} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-sheraton-gold uppercase tracking-wide mb-1">
                                  {task.id}
                                </p>
                                <h3 className="font-semibold text-sheraton-navy line-clamp-2">
                                  {task.title}
                                </h3>
                              </div>
                            </div>
                            <Badge className={getPriorityColor(task.priority)}>
                              {task.priority}
                            </Badge>
                          </div>

                          {/* Description */}
                          <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                            {task.description}
                          </p>

                          {/* Task Details */}
                          <div className="space-y-3 mb-5 text-sm">
                            {task.category && (
                              <div className="flex justify-between items-center">
                                <span className="text-gray-500 text-xs font-medium">CATEGORY</span>
                                <span className="font-semibold text-gray-900 capitalize">{task.category}</span>
                              </div>
                            )}
                            {task.due_date && (
                              <div className="flex justify-between items-center">
                                <span className="text-gray-500 text-xs font-medium">DUE DATE</span>
                                <span className="font-semibold text-gray-900">
                                  {new Date(task.due_date).toLocaleDateString()}
                                </span>
                              </div>
                            )}
                            {task.estimated_time && (
                              <div className="flex justify-between items-center">
                                <span className="text-gray-500 text-xs font-medium">EST. TIME</span>
                                <span className="font-semibold text-gray-900">{task.estimated_time}</span>
                              </div>
                            )}
                            {(task as any).budget && (
                              <div className="flex justify-between items-center">
                                <span className="text-gray-500 text-xs font-medium">BUDGET</span>
                                <span className="font-semibold text-green-700">
                                  ${parseFloat((task as any).budget).toFixed(2)}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Attachments */}
                          {taskAttachments.get(task.id) &&
                            taskAttachments.get(task.id)!.length > 0 && (
                              <div className="pt-2 border-t mt-3">
                                <AttachmentList
                                  attachments={taskAttachments.get(task.id)!}
                                  compact={true}
                                />
                              </div>
                            )}

                          {/* Action Buttons */}
                          <div className="flex gap-2 pt-4 mt-4 border-t flex-wrap">
                            <Button
                              size="sm"
                              className="ml-auto bg-blue-600 hover:bg-blue-700 text-white"
                              onClick={() => {
                                setSelectedTaskForResponse(task);
                                setShowResponseModal(true);
                              }}
                            >
                              <AlertCircle className="h-4 w-4 mr-1" />
                              Respond
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedTask(task.id);
                                handleTabChange("live-chat");
                              }}
                              className="hover:bg-sheraton-gold hover:text-white"
                            >
                              <MessageSquare className="h-4 w-4 mr-1" />
                              Chat
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {getUnrespondedAssignedTasks().length === 0 && (
                    <Card className="border-2 border-dashed border-orange-200 bg-orange-50/30">
                      <CardContent className="p-8 text-center">
                        <p className="text-muted-foreground">
                          No tasks awaiting your response at this time
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* SECTION 2: PENDING PROPOSALS */}
                {getPendingProposalsForProvider().length > 0 && (
                  <div className="space-y-4 my-8 pt-8 border-t-2 border-gray-200">
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-6 w-6 text-blue-600" />
                      <div>
                        <h2 className="text-2xl font-bold text-sheraton-navy">Active Proposals</h2>
                        <p className="text-sm text-gray-600">
                          {getPendingProposalsForProvider().length} proposal(s) under negotiation
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {getPendingProposalsForProvider().map((proposal) => (
                        <ServiceProviderProposalReview
                          key={proposal.id}
                          proposal={proposal}
                          taskTitle={
                            tasks.find((t) => t.id === proposal.task_id)?.title ||
                            "Unknown Task"
                          }
                          onProposalUpdated={() => {
                            // Reload proposals
                            supabase
                              .from("task_proposals")
                              .select("*")
                              .order("created_at", { ascending: false })
                              .then(({ data }) => setTaskProposals(data || []));
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* SECTION 3: YOUR ACCEPTED TASKS */}
                {todoItems.length > 0 && (
                  <div className="space-y-4 my-8 pt-8 border-t-2 border-gray-200">
                    <div className="flex items-center gap-3">
                      <CheckSquare className="h-6 w-6 text-green-500" />
                      <div>
                        <h2 className="text-2xl font-bold text-sheraton-navy">Your Accepted Tasks</h2>
                        <p className="text-sm text-gray-600">
                          {todoItems.length} task(s) in progress
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {todoItems.map((todo) => (
                        <TodoItem
                          key={todo.id}
                          todo={todo}
                          attachments={todoAttachments.get(todo.id) || []}
                          onTodoUpdated={() => {
                            // Reload todos
                            if (currentUserProfile) {
                              supabase
                                .from("todo_list")
                                .select("*")
                                .eq("provider_id", currentUserProfile.id)
                                .order("created_at", { ascending: false })
                                .then(({ data }) => setTodoItems(data || []));
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              // Manager View - Show all tasks with filters and view mode
              <>
                {/* Toolbar */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                  <div className="flex-1 flex gap-2 w-full md:w-auto">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search tasks..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 border-gray-200"
                      />
                    </div>

                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger className="w-40 border-gray-200">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Filter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="todo">To Do</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="in_review">In Review</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-2 border-l pl-4">
                    <Button
                      variant={viewMode === "grid" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setViewMode("grid")}
                      className={viewMode === "grid" ? "sheraton-gradient text-white" : ""}
                      title="Grid view"
                    >
                      <Grid3x3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === "list" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setViewMode("list")}
                      className={viewMode === "list" ? "sheraton-gradient text-white" : ""}
                      title="List view"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* PENDING PROPOSALS SECTION - Manager View */}
                {taskProposals.some((p) => p.status === "pending") && (
                  <div className="space-y-4 my-8">
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-6 w-6 text-blue-600" />
                      <div>
                        <h2 className="text-2xl font-bold text-sheraton-navy">Pending Proposals</h2>
                        <p className="text-sm text-gray-600">
                          {taskProposals.filter((p) => p.status === "pending").length} proposal(s) awaiting your review
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {taskProposals
                        .filter((p) => p.status === "pending")
                        .map((proposal) => {
                          const task = tasks.find((t) => t.id === proposal.task_id);
                          return (
                            <ManagerProposalReview
                              key={proposal.id}
                              proposal={proposal}
                              taskTitle={task?.title || "Unknown Task"}
                              providerName={task?.assignee_name || "Unknown Provider"}
                              onProposalUpdated={() => {
                                // Reload proposals
                                supabase
                                  .from("task_proposals")
                                  .select("*")
                                  .order("created_at", { ascending: false })
                                  .then(({ data }) => setTaskProposals(data || []));

                                // Reload todos in case one was created
                                if (currentUserProfile) {
                                  supabase
                                    .from("todo_list")
                                    .select("*")
                                    .eq("provider_id", proposal.provider_id)
                                    .order("created_at", { ascending: false })
                                    .then(({ data }) => setTodoItems(data || []));
                                }
                              }}
                            />
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* DIVIDER */}
                {taskProposals.some((p) => p.status === "pending") && (
                  <div className="border-t-2 border-gray-200 my-8"></div>
                )}

                {/* Tasks Display */}
                <div
                  className={
                    viewMode === "grid"
                      ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
                      : "space-y-4"
                  }
                >
                  {filteredTasks.map((task) => (
                    <Card
                      key={task.id}
                      className={`${getStatusColor(task.status)} hover:shadow-lg transition-shadow overflow-hidden`}
                    >
                      <CardContent className="p-6">
                        {/* Header with Status and Priority */}
                        <div className="flex items-start justify-between mb-4 pb-4 border-b">
                          <div className="flex items-start gap-3 flex-1">
                            <div className="p-2 bg-white rounded-lg flex-shrink-0">
                              <StatusIcon status={task.status} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-xs font-semibold text-sheraton-gold uppercase tracking-wide">
                                  {task.id}
                                </p>
                                {(task as any).is_from_complaint && (
                                  <Badge className="bg-orange-100 text-orange-800 text-xs">
                                    <Tag className="h-3 w-3 mr-1" />
                                    From Complaint
                                  </Badge>
                                )}
                              </div>
                              <h3 className="font-bold text-sheraton-navy mt-1 line-clamp-2 hover:text-sheraton-gold transition-colors">
                                {task.title}
                              </h3>
                            </div>
                          </div>
                          <Badge className={`${getPriorityColor(task.priority)} font-semibold flex-shrink-0 ml-2`}>
                            {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                          </Badge>
                        </div>

                        {/* Description */}
                        <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                          {task.description}
                        </p>

                        {/* Task Details Grid */}
                        <div className="space-y-3 mb-5 text-sm">
                          {task.category && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 text-xs font-medium">CATEGORY</span>
                              <span className="font-semibold text-gray-900 capitalize">{task.category}</span>
                            </div>
                          )}
                          {task.assignee_name && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 text-xs font-medium">ASSIGNED TO</span>
                              <span className="font-semibold text-gray-900">{task.assignee_name}</span>
                            </div>
                          )}
                          {task.due_date && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 text-xs font-medium">DUE DATE</span>
                              <span className="font-semibold text-gray-900">
                                {new Date(task.due_date).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                          {task.estimated_time && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 text-xs font-medium">EST. TIME</span>
                              <span className="font-semibold text-gray-900">{task.estimated_time}</span>
                            </div>
                          )}
                          {(task as any).budget && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 text-xs font-medium">BUDGET</span>
                              <span className="font-semibold text-green-700">
                                ${parseFloat((task as any).budget).toFixed(2)}
                              </span>
                            </div>
                          )}
                          {task.assigned_category && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 text-xs font-medium">TYPE</span>
                              <Badge
                                className={
                                  task.assigned_category === "internal"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-purple-100 text-purple-800"
                                }
                              >
                                {task.assigned_category === "internal" ? "Internal" : "External"}
                              </Badge>
                            </div>
                          )}
                          {taskAttachments.get(task.id) &&
                            taskAttachments.get(task.id)!.length > 0 && (
                              <div className="pt-2 border-t mt-3">
                                <AttachmentList
                                  attachments={taskAttachments.get(task.id)!}
                                  compact={true}
                                />
                              </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 pt-4 border-t flex-wrap">
                          <Badge variant="outline" className="bg-white">
                            {getStatusLabel(task.status)}
                          </Badge>

                          {/* Show response button if this task is assigned to current service provider */}
                          {userRole === "service_provider" &&
                            task.assigned_to === currentUserProfile?.id &&
                            !taskResponses.find((r) => r.task_id === task.id) && (
                              <Button
                                size="sm"
                                className="ml-auto bg-blue-600 hover:bg-blue-700 text-white"
                                onClick={() => {
                                  setSelectedTaskForResponse(task);
                                  setShowResponseModal(true);
                                }}
                              >
                                <AlertCircle className="h-4 w-4 mr-1" />
                                Respond
                              </Button>
                            )}

                          {/* Always show chat button */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedTask(task.id);
                              handleTabChange("live-chat");
                            }}
                            className={`${
                              userRole === "service_provider" &&
                              task.assigned_to === currentUserProfile?.id &&
                              !taskResponses.find((r) => r.task_id === task.id)
                                ? ""
                                : "ml-auto"
                            } hover:bg-sheraton-gold hover:text-white`}
                          >
                            <MessageSquare className="h-4 w-4 mr-1" />
                            Chat
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {filteredTasks.length === 0 && (
                  <Card className="col-span-full border-2 border-dashed border-sheraton-gold bg-sheraton-cream">
                    <CardContent className="p-12 text-center">
                      <div className="flex justify-center mb-6">
                        <CheckSquare className="h-16 w-16 text-sheraton-gold opacity-40" />
                      </div>
                      <h3 className="text-xl font-semibold text-sheraton-navy mb-2">No tasks found</h3>
                      <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                        Try adjusting your search or filters, or create a new task to get started
                      </p>
                      <Button
                        onClick={() => handleTabChange("new-task")}
                        className="sheraton-gradient text-white"
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Create New Task
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* Live Chat Tab */}
          <TabsContent value="live-chat" className="space-y-6">
            {selectedTask ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-300px)]">
                {/* Chat Area */}
                {currentUser && userRole && (
                  <TaskChat
                    taskId={selectedTask}
                    currentUserId={currentUser.id}
                    currentUserRole={userRole as "manager" | "service_provider"}
                    taskStatus={tasks.find((t) => t.id === selectedTask)?.status || ""}
                    otherPartyName={
                      userRole === "manager"
                        ? tasks.find((t) => t.id === selectedTask)?.assignee_name || "Provider"
                        : tasks.find((t) => t.id === selectedTask)?.title || "Manager"
                    }
                  />
                )}

                {/* Task Details Sidebar */}
                <Card className="bg-gradient-to-b from-sheraton-cream to-white border-sheraton-gold">
                  <CardHeader>
                    <CardTitle className="text-sheraton-navy">Task Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6 text-sm">
                    {tasks.find((t) => t.id === selectedTask) && (
                      <>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            ID
                          </p>
                          <p className="font-semibold text-sheraton-navy font-mono">
                            {tasks.find((t) => t.id === selectedTask)?.id}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Priority
                          </p>
                          <Badge className={`${getPriorityColor(
                            tasks.find((t) => t.id === selectedTask)?.priority || ""
                          )} font-semibold`}>
                            {tasks
                              .find((t) => t.id === selectedTask)
                              ?.priority.charAt(0)
                              .toUpperCase()}
                            {tasks.find((t) => t.id === selectedTask)?.priority.slice(1)}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Assigned To
                          </p>
                          <p className="font-semibold text-sheraton-navy">
                            {tasks.find((t) => t.id === selectedTask)?.assignee_name}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Due Date
                          </p>
                          <p className="font-semibold text-sheraton-navy">
                            {tasks.find((t) => t.id === selectedTask)?.due_date
                              ? new Date(
                                  tasks.find((t) => t.id === selectedTask)?.due_date || ""
                                ).toLocaleDateString()
                              : "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Status
                          </p>
                          <Badge variant="outline" className="bg-white">
                            {getStatusLabel(
                              tasks.find((t) => t.id === selectedTask)?.status || ""
                            )}
                          </Badge>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card className="border-2 border-dashed border-sheraton-gold bg-sheraton-cream">
                <CardContent className="p-12 text-center">
                  <div className="flex justify-center mb-6">
                    <MessageSquare className="h-16 w-16 text-sheraton-gold opacity-40" />
                  </div>
                  <h3 className="text-xl font-semibold text-sheraton-navy mb-2">
                    Select a task to view chat
                  </h3>
                  <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                    Click "Chat" on any task from the Task List tab to start or view conversations
                  </p>
                  <Button
                    onClick={() => handleTabChange("todo-list")}
                    className="sheraton-gradient text-white"
                  >
                    <CheckSquare className="h-4 w-4 mr-2" />
                    Go to Task List
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Task Response Modal */}
        {selectedTaskForResponse && currentUserProfile && (
          <TaskResponseModal
            isOpen={showResponseModal}
            task={selectedTaskForResponse}
            providerId={currentUserProfile.id}
            providerName={`${currentUserProfile.first_name} ${currentUserProfile.last_name}`}
            onClose={() => {
              setShowResponseModal(false);
              setSelectedTaskForResponse(null);
            }}
            onResponseSubmitted={() => {
              // Reload task responses and refresh data
              supabase
                .from("task_responses")
                .select("*")
                .order("created_at", { ascending: false })
                .then(({ data }) => setTaskResponses(data || []));

              // Reload todos in case one was created
              if (currentUserProfile) {
                supabase
                  .from("todo_list")
                  .select("*")
                  .eq("provider_id", currentUserProfile.id)
                  .order("created_at", { ascending: false })
                  .then(({ data }) => setTodoItems(data || []));
              }

              // Close modal and reset
              setShowResponseModal(false);
              setSelectedTaskForResponse(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default TasksPage;
