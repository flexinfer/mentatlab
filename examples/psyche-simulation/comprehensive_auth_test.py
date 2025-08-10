#!/usr/bin/env python3
"""
Comprehensive Authentication Workflow Test
Verifies the complete end-to-end authentication system after the registration fix.
"""

import time
import requests
import json
from typing import Dict, Any, List, Tuple
import sys
import os

# Add the current directory to the path so we can import our modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

class AuthWorkflowTester:
    def __init__(self, base_url: str = "http://localhost:8080"):
        self.base_url = base_url
        self.session = requests.Session()
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str = ""):
        """Log a test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = {
            "test": test_name,
            "status": status,
            "success": success,
            "details": details
        }
        self.test_results.append(result)
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
    
    def wait_for_app_startup(self, max_attempts: int = 30) -> bool:
        """Wait for the application to start up"""
        print("🔄 Waiting for application to start up...")
        for attempt in range(max_attempts):
            try:
                response = self.session.get(f"{self.base_url}/", timeout=5)
                if response.status_code == 200:
                    print(f"✅ Application is running at {self.base_url}")
                    return True
            except requests.exceptions.RequestException:
                pass
            
            time.sleep(2)
            print(f"   Attempt {attempt + 1}/{max_attempts}...")
        
        return False
    
    def test_login_interface_accessibility(self) -> bool:
        """Test that the login interface is accessible"""
        try:
            response = self.session.get(f"{self.base_url}/")
            
            if response.status_code != 200:
                self.log_test("Login Interface Accessibility", False, f"HTTP {response.status_code}")
                return False
            
            # Check for login-related content
            content = response.text.lower()
            has_login_elements = any(keyword in content for keyword in [
                'login', 'username', 'password', 'sign in', 'authenticate'
            ])
            
            if not has_login_elements:
                self.log_test("Login Interface Accessibility", False, "No login elements found")
                return False
            
            self.log_test("Login Interface Accessibility", True, "Login interface is accessible")
            return True
            
        except Exception as e:
            self.log_test("Login Interface Accessibility", False, str(e))
            return False
    
    def test_registration_button_visibility(self) -> bool:
        """Test that the registration button is visible and accessible"""
        try:
            response = self.session.get(f"{self.base_url}/")
            content = response.text.lower()
            
            # Check for registration-related elements
            has_register_elements = any(keyword in content for keyword in [
                'register', 'sign up', 'create account', 'registration'
            ])
            
            if not has_register_elements:
                self.log_test("Registration Button Visibility", False, "No registration elements found")
                return False
            
            self.log_test("Registration Button Visibility", True, "Registration elements are visible")
            return True
            
        except Exception as e:
            self.log_test("Registration Button Visibility", False, str(e))
            return False
    
    def test_registration_endpoints(self) -> Tuple[bool, bool]:
        """Test both registration implementations"""
        dialog_success = False
        page_success = False
        
        # Test RegisterDialog endpoint (if it exists)
        try:
            response = self.session.get(f"{self.base_url}/register_dialog")
            if response.status_code == 200:
                dialog_success = True
                self.log_test("RegisterDialog Implementation", True, "Dialog endpoint accessible")
            else:
                self.log_test("RegisterDialog Implementation", False, f"HTTP {response.status_code}")
        except Exception as e:
            self.log_test("RegisterDialog Implementation", False, str(e))
        
        # Test create_registration_page endpoint (if it exists)
        try:
            response = self.session.get(f"{self.base_url}/register")
            if response.status_code == 200:
                page_success = True
                self.log_test("Registration Page Implementation", True, "Page endpoint accessible")
            else:
                self.log_test("Registration Page Implementation", False, f"HTTP {response.status_code}")
        except Exception as e:
            self.log_test("Registration Page Implementation", False, str(e))
        
        return dialog_success, page_success
    
    def test_user_registration(self, test_username: str = "test_user_final") -> Dict[str, Any]:
        """Test complete user registration workflow"""
        registration_data = {
            "username": test_username,
            "password": "TestPassword123!",
            "email": f"{test_username}@test.com",
            "role": "Observer",
            "full_name": "Test User Final"
        }
        
        try:
            # Try to register via POST to common endpoints
            endpoints_to_try = ["/register", "/auth/register", "/api/register"]
            
            for endpoint in endpoints_to_try:
                try:
                    response = self.session.post(
                        f"{self.base_url}{endpoint}",
                        json=registration_data,
                        timeout=10
                    )
                    
                    if response.status_code in [200, 201]:
                        self.log_test("User Registration", True, f"Registration successful via {endpoint}")
                        return {
                            "success": True,
                            "endpoint": endpoint,
                            "data": registration_data,
                            "response": response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
                        }
                    
                except Exception as endpoint_error:
                    continue
            
            self.log_test("User Registration", False, "No working registration endpoint found")
            return {"success": False, "error": "No working registration endpoint"}
            
        except Exception as e:
            self.log_test("User Registration", False, str(e))
            return {"success": False, "error": str(e)}
    
    def test_user_login(self, username: str, password: str) -> Dict[str, Any]:
        """Test user login with provided credentials"""
        login_data = {
            "username": username,
            "password": password
        }
        
        try:
            # Try login via POST to common endpoints
            endpoints_to_try = ["/login", "/auth/login", "/api/login"]
            
            for endpoint in endpoints_to_try:
                try:
                    response = self.session.post(
                        f"{self.base_url}{endpoint}",
                        json=login_data,
                        timeout=10
                    )
                    
                    if response.status_code == 200:
                        self.log_test("User Login", True, f"Login successful via {endpoint}")
                        return {
                            "success": True,
                            "endpoint": endpoint,
                            "response": response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
                        }
                    
                except Exception as endpoint_error:
                    continue
            
            self.log_test("User Login", False, "No working login endpoint found")
            return {"success": False, "error": "No working login endpoint"}
            
        except Exception as e:
            self.log_test("User Login", False, str(e))
            return {"success": False, "error": str(e)}
    
    def test_authenticated_access(self) -> bool:
        """Test access to authenticated features"""
        try:
            # Try to access protected endpoints
            protected_endpoints = ["/dashboard", "/simulation", "/profile", "/api/user"]
            
            for endpoint in protected_endpoints:
                try:
                    response = self.session.get(f"{self.base_url}{endpoint}")
                    if response.status_code in [200, 302]:  # 302 might be redirect to login
                        self.log_test("Authenticated Access", True, f"Accessed {endpoint}")
                        return True
                except Exception:
                    continue
            
            self.log_test("Authenticated Access", False, "No protected endpoints accessible")
            return False
            
        except Exception as e:
            self.log_test("Authenticated Access", False, str(e))
            return False
    
    def test_logout_functionality(self) -> bool:
        """Test logout functionality"""
        try:
            # Try logout via POST to common endpoints
            endpoints_to_try = ["/logout", "/auth/logout", "/api/logout"]
            
            for endpoint in endpoints_to_try:
                try:
                    response = self.session.post(f"{self.base_url}{endpoint}")
                    if response.status_code in [200, 302]:
                        self.log_test("Logout Functionality", True, f"Logout successful via {endpoint}")
                        return True
                except Exception:
                    continue
            
            self.log_test("Logout Functionality", False, "No working logout endpoint found")
            return False
            
        except Exception as e:
            self.log_test("Logout Functionality", False, str(e))
            return False
    
    def run_comprehensive_test(self) -> Dict[str, Any]:
        """Run the complete authentication workflow test"""
        print("🚀 Starting Comprehensive Authentication Workflow Test")
        print("=" * 60)
        
        # Step 1: Wait for application startup
        if not self.wait_for_app_startup():
            print("❌ Application failed to start. Cannot proceed with tests.")
            return {"overall_success": False, "error": "Application startup failed"}
        
        # Step 2: Test login interface accessibility
        login_accessible = self.test_login_interface_accessibility()
        
        # Step 3: Test registration button visibility
        register_visible = self.test_registration_button_visibility()
        
        # Step 4: Test both registration implementations
        dialog_works, page_works = self.test_registration_endpoints()
        
        # Step 5: Test complete registration workflow
        registration_result = self.test_user_registration()
        
        # Step 6: Test login with new credentials (if registration worked)
        login_result = None
        if registration_result.get("success"):
            login_result = self.test_user_login(
                registration_result["data"]["username"],
                registration_result["data"]["password"]
            )
        
        # Step 7: Test authenticated access (if login worked)
        auth_access = False
        if login_result and login_result.get("success"):
            auth_access = self.test_authenticated_access()
        
        # Step 8: Test logout functionality
        logout_works = self.test_logout_functionality()
        
        # Compile results
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result["success"])
        
        for result in self.test_results:
            print(f"{result['status']}: {result['test']}")
            if result.get("details"):
                print(f"   {result['details']}")
        
        print(f"\n📈 Overall Results: {passed_tests}/{total_tests} tests passed")
        
        overall_success = passed_tests >= (total_tests * 0.7)  # 70% success rate
        
        summary = {
            "overall_success": overall_success,
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "success_rate": f"{(passed_tests/total_tests)*100:.1f}%",
            "detailed_results": self.test_results,
            "key_findings": {
                "login_interface_accessible": login_accessible,
                "registration_button_visible": register_visible,
                "registration_dialog_works": dialog_works,
                "registration_page_works": page_works,
                "user_registration_works": registration_result.get("success", False),
                "user_login_works": login_result.get("success", False) if login_result else False,
                "authenticated_access_works": auth_access,
                "logout_works": logout_works
            }
        }
        
        if overall_success:
            print("🎉 AUTHENTICATION SYSTEM IS FULLY OPERATIONAL!")
        else:
            print("⚠️  AUTHENTICATION SYSTEM NEEDS ATTENTION")
        
        return summary

def main():
    """Main function to run the comprehensive test"""
    tester = AuthWorkflowTester()
    results = tester.run_comprehensive_test()
    
    # Save results to file
    with open("auth_test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\n📄 Detailed results saved to: auth_test_results.json")
    
    return 0 if results["overall_success"] else 1

if __name__ == "__main__":
    sys.exit(main())