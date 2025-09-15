#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

// Try to load dotenv if available
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available, that's okay
}

// Dynamic import for node-fetch (ES module)
let fetch;
(async () => {
  if (!fetch) {
    const { default: nodeFetch } = await import('node-fetch');
    fetch = nodeFetch;
  }
})();

// Configuration
const CANVAS_URL = process.env.CANVAS_URL || 'https://your-institution.instructure.com';
const API_TOKEN = process.env.CANVAS_API_TOKEN || 'your-api-token';
const COURSE_ID = process.env.COURSE_ID || 'your-course-id';

const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json'
};

/**
 * Parse markdown file to extract project names and leaders
 */
async function parseProjectsFromMD(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const projects = [];
    const lines = content.split('\n');
    
    let currentProject = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match project headers: "## Project Name"
      if (line.startsWith('## ') && !line.includes('Project Ideas')) {
        currentProject = line.replace('## ', '').trim();
      }
      // Match leader lines: "- Leader Name"
      else if (line.startsWith('- ') && currentProject) {
        const leaderName = line.replace('- ', '').trim();
        
        projects.push({
          projectName: currentProject,
          leaderName: leaderName
        });
        
        currentProject = null; // Reset for next project
      }
    }
    
    return projects;
  } catch (error) {
    console.error('Error reading markdown file:', error);
    return [];
  }
}

/**
 * Get course students from Canvas
 */
async function getCourseStudents(courseId) {
  try {
    // Ensure fetch is available
    if (!fetch) {
      const { default: nodeFetch } = await import('node-fetch');
      fetch = nodeFetch;
    }
    
    const response = await fetch(`${CANVAS_URL}/api/v1/courses/${courseId}/students?per_page=100`, {
      headers: headers
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching students:', error.message);
    return [];
  }
}

/**
 * Find student by name (fuzzy matching)
 */
function findStudentByName(students, targetName) {
  const normalize = (name) => name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  const targetNormalized = normalize(targetName);
  
  // Try exact match first
  let student = students.find(s => normalize(s.name) === targetNormalized);
  if (student) return student;
  
  // Try matching by first and last name parts
  const nameParts = targetNormalized.split(/\s+/);
  student = students.find(s => {
    const studentNormalized = normalize(s.name);
    return nameParts.every(part => studentNormalized.includes(part));
  });
  
  if (student) return student;
  
  // Try partial matching (first name or last name)
  student = students.find(s => {
    const studentNormalized = normalize(s.name);
    return nameParts.some(part => studentNormalized.includes(part) && part.length > 2);
  });
  
  return student;
}

/**
 * Get existing group categories for a course
 */
async function getGroupCategories(courseId) {
  try {
    if (!fetch) {
      const { default: nodeFetch } = await import('node-fetch');
      fetch = nodeFetch;
    }
    
    const response = await fetch(`${CANVAS_URL}/api/v1/courses/${courseId}/group_categories?per_page=100`, {
      headers: headers
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching group categories:', error.message);
    return [];
  }
}

/**
 * Find existing group category by name
 */
async function findGroupCategory(courseId, categoryName) {
  const categories = await getGroupCategories(courseId);
  return categories.find(cat => cat.name === categoryName);
}

/**
 * Create group category
 */
async function createGroupCategory(courseId, categoryName) {
  try {
    if (!fetch) {
      const { default: nodeFetch } = await import('node-fetch');
      fetch = nodeFetch;
    }
    
    const response = await fetch(`${CANVAS_URL}/api/v1/courses/${courseId}/group_categories`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        name: categoryName,
        self_signup: null,
        group_limit: null,
        auto_leader: null
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error creating group category:', error.message);
    return null;
  }
}

/**
 * Create a group within a category
 */
async function createGroup(groupCategoryId, groupName, description = '') {
  try {
    if (!fetch) {
      const { default: nodeFetch } = await import('node-fetch');
      fetch = nodeFetch;
    }
    
    const response = await fetch(`${CANVAS_URL}/api/v1/group_categories/${groupCategoryId}/groups`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        name: groupName,
        description: description,
        is_public: false,
        join_level: 'invitation_only'
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error creating group ${groupName}:`, error.message);
    return null;
  }
}

/**
 * Add student to group
 */
async function addStudentToGroup(groupId, userId) {
  try {
    if (!fetch) {
      const { default: nodeFetch } = await import('node-fetch');
      fetch = nodeFetch;
    }
    
    const response = await fetch(`${CANVAS_URL}/api/v1/groups/${groupId}/memberships`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        user_id: userId
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error adding student to group:`, error.message);
    return null;
  }
}

/**
 * Set group leader (Canvas Pro feature - alternative: add leader role in description)
 */
async function setGroupLeader(groupId, userId) {
  try {
    if (!fetch) {
      const { default: nodeFetch } = await import('node-fetch');
      fetch = nodeFetch;
    }
    
    const response = await fetch(`${CANVAS_URL}/api/v1/groups/${groupId}/memberships`, {
      method: 'GET',
      headers: headers
    });
    
    if (!response.ok) return false;
    
    const memberships = await response.json();
    const membership = memberships.find(m => m.user_id === userId);
    
    if (!membership) return false;
    
    // Try to update membership to moderator
    const updateResponse = await fetch(`${CANVAS_URL}/api/v1/groups/${groupId}/memberships/${membership.id}`, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({
        moderator: true
      })
    });
    
    return updateResponse.ok;
  } catch (error) {
    console.warn(`Could not set leader permissions:`, error.message);
    return false;
  }
}

/**
 * Test Canvas API connection
 */
async function testCanvasConnection() {
  try {
    if (!fetch) {
      const { default: nodeFetch } = await import('node-fetch');
      fetch = nodeFetch;
    }
    
    const response = await fetch(`${CANVAS_URL}/api/v1/users/self`, {
      headers: headers
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const user = await response.json();
    console.log(`✅ Connected to Canvas as: ${user.name}`);
    return true;
  } catch (error) {
    console.error('❌ Canvas connection failed:', error.message);
    return false;
  }
}

/**
 * Main function to process projects and create groups
 */
async function createProjectGroups(mdFilePath) {
  console.log('🚀 Starting Canvas group creation process...\n');
  
  // Test Canvas connection first
  const connected = await testCanvasConnection();
  if (!connected) {
    console.error('❌ Cannot connect to Canvas. Please check your configuration.');
    return;
  }
  
  // Parse projects from markdown
  console.log('\n📖 Parsing project ideas from markdown...');
  const projects = await parseProjectsFromMD(mdFilePath);
  
  if (projects.length === 0) {
    console.error('❌ No projects found in markdown file');
    return;
  }
  
  console.log(`✅ Found ${projects.length} projects\n`);
  
  // Get course students
  console.log('👥 Fetching course students...');
  const students = await getCourseStudents(COURSE_ID);
  
  if (students.length === 0) {
    console.error('❌ No students found in course');
    return;
  }
  
  console.log(`✅ Found ${students.length} students\n`);
  
  // Check for existing group category or create new one
  console.log('📁 Checking for existing group category...');
  let category = await findGroupCategory(COURSE_ID, 'Project Groups');
  
  if (category) {
    console.log(`✅ Found existing category: ${category.name} (ID: ${category.id})\n`);
  } else {
    console.log('📁 Creating new group category...');
    category = await createGroupCategory(COURSE_ID, 'Project Groups');
    
    if (!category) {
      console.error('❌ Failed to create group category');
      return;
    }
    
    console.log(`✅ Created category: ${category.name} (ID: ${category.id})\n`);
  }
  
  // Process each project
  const results = [];
  
  for (const project of projects) {
    console.log(`🔧 Processing: ${project.projectName}`);
    console.log(`👤 Leader: ${project.leaderName}`);
    
    // Find the leader student
    const leaderStudent = findStudentByName(students, project.leaderName);
    
    if (!leaderStudent) {
      console.warn(`⚠️  Could not find student: ${project.leaderName}`);
      results.push({
        project: project.projectName,
        leader: project.leaderName,
        status: 'Leader not found',
        groupId: null
      });
      console.log('');
      continue;
    }
    
    console.log(`✅ Found leader: ${leaderStudent.name} (ID: ${leaderStudent.id})`);
    
    // Create group
    const group = await createGroup(
      category.id, 
      project.projectName,
      `Project: ${project.projectName}\nLeader: ${leaderStudent.name}`
    );
    
    if (!group) {
      console.error(`❌ Failed to create group for ${project.projectName}`);
      results.push({
        project: project.projectName,
        leader: project.leaderName,
        status: 'Group creation failed',
        groupId: null
      });
      console.log('');
      continue;
    }
    
    console.log(`✅ Created group: ${group.name} (ID: ${group.id})`);
    
    // Add leader to group
    const membership = await addStudentToGroup(group.id, leaderStudent.id);
    
    if (!membership) {
      console.error(`❌ Failed to add leader to group`);
      results.push({
        project: project.projectName,
        leader: project.leaderName,
        status: 'Failed to add leader',
        groupId: group.id
      });
      console.log('');
      continue;
    }
    
    // Try to set as group leader/moderator
    const isLeader = await setGroupLeader(group.id, leaderStudent.id);
    const leaderStatus = isLeader ? 'with leader permissions' : 'as member';
    
    console.log(`✅ Added ${leaderStudent.name} to group ${leaderStatus}`);
    
    results.push({
      project: project.projectName,
      leader: leaderStudent.name,
      status: 'Success',
      groupId: group.id,
      canvasGroupUrl: `${CANVAS_URL}/groups/${group.id}`
    });
    
    console.log('');
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log('🎉 Process completed!\n');
  console.log('📊 SUMMARY:');
  console.log('='.repeat(50));
  
  const successful = results.filter(r => r.status === 'Success');
  const failed = results.filter(r => r.status !== 'Success');
  
  console.log(`✅ Successfully created: ${successful.length} groups`);
  console.log(`❌ Failed: ${failed.length} groups\n`);
  
  if (successful.length > 0) {
    console.log('✅ SUCCESSFUL GROUPS:');
    successful.forEach(result => {
      console.log(`  • ${result.project} - ${result.leader}`);
      console.log(`    Group URL: ${result.canvasGroupUrl}`);
    });
    console.log('');
  }
  
  if (failed.length > 0) {
    console.log('❌ FAILED GROUPS:');
    failed.forEach(result => {
      console.log(`  • ${result.project} - ${result.leader}: ${result.status}`);
    });
  }
  
  return results;
}

/**
 * Validate environment and configuration
 */
function validateConfig() {
  const errors = [];
  
  if (!process.env.CANVAS_API_TOKEN || process.env.CANVAS_API_TOKEN === 'your-api-token') {
    errors.push('CANVAS_API_TOKEN not set or using default value');
  }
  
  if (!process.env.COURSE_ID || process.env.COURSE_ID === 'your-course-id') {
    errors.push('COURSE_ID not set or using default value');
  }
  
  if (!process.env.CANVAS_URL || process.env.CANVAS_URL === 'https://your-institution.instructure.com') {
    errors.push('CANVAS_URL not set or using default value');
  }
  
  return errors;
}

// Usage
async function main() {
  console.log('🎯 Canvas Group Creator\n');
  
  // Validate configuration
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    console.error('❌ Configuration errors:');
    configErrors.forEach(error => console.error(`  • ${error}`));
    console.error('\nPlease check your .env file or environment variables.');
    process.exit(1);
  }
  
  // Check if markdown file exists
  const mdFile = './project-ideas.md';
  try {
    await fs.access(mdFile);
  } catch (error) {
    console.error(`❌ Cannot find ${mdFile}`);
    console.error('Please make sure the project-ideas.md file exists in the current directory.');
    process.exit(1);
  }
  
  // Run the main process
  const results = await createProjectGroups(mdFile);
  
  if (results && results.length > 0) {
    console.log(`\n🏁 Finished processing ${results.length} projects.`);
    const successCount = results.filter(r => r.status === 'Success').length;
    console.log(`Success rate: ${Math.round((successCount / results.length) * 100)}%`);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = {
  parseProjectsFromMD,
  createProjectGroups,
  getCourseStudents,
  findStudentByName,
  testCanvasConnection,
  getGroupCategories,
  findGroupCategory,
  createGroupCategory
};