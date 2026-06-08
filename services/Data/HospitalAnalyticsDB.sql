-- ============================================================
-- HospitalAnalyticsDB - Complete Production Schema
-- Optimized for Text-to-SQL evaluation and benchmarking
-- Single valid join path per business question
-- ============================================================

USE master;
GO

IF EXISTS (SELECT name FROM sys.databases WHERE name = N'HospitalAnalyticsDB')
BEGIN
    ALTER DATABASE HospitalAnalyticsDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE HospitalAnalyticsDB;
END
GO

CREATE DATABASE HospitalAnalyticsDB;
GO

USE HospitalAnalyticsDB;
GO

-- ============================================================
-- TABLES
-- ============================================================

-- Departments
CREATE TABLE dbo.Departments (
    DepartmentID INT IDENTITY(1,1) PRIMARY KEY,
    DepartmentCode VARCHAR(20) NOT NULL UNIQUE,
    DepartmentName VARCHAR(100) NOT NULL
);
GO

-- Employees
CREATE TABLE dbo.Employees (
    EmployeeID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeCode VARCHAR(20) NOT NULL UNIQUE,
    DepartmentID INT NOT NULL,
    FirstName VARCHAR(50) NOT NULL,
    LastName VARCHAR(50) NOT NULL,
    Gender CHAR(1) NOT NULL CHECK (Gender IN ('M', 'F')),
    DateOfBirth DATE NOT NULL,
    HireDate DATE NOT NULL,
    Email VARCHAR(100),
    Phone VARCHAR(20),
    Status VARCHAR(10) NOT NULL DEFAULT 'Active' CHECK (Status IN ('Active', 'Inactive', 'OnLeave')),
    CONSTRAINT FK_Employees_Department FOREIGN KEY (DepartmentID) REFERENCES dbo.Departments(DepartmentID)
);
GO

-- Doctors (1:1 with Employee)
CREATE TABLE dbo.Doctors (
    DoctorID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL UNIQUE,
    Specialization VARCHAR(100) NOT NULL,
    Qualification VARCHAR(100) NOT NULL,
    LicenseNumber VARCHAR(50) NOT NULL UNIQUE,
    ConsultationFee DECIMAL(10,2) NOT NULL,
    CONSTRAINT FK_Doctors_Employee FOREIGN KEY (EmployeeID) REFERENCES dbo.Employees(EmployeeID)
);
GO

-- Staff (1:1 with Employee)
CREATE TABLE dbo.Staff (
    StaffID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL UNIQUE,
    StaffType VARCHAR(50) NOT NULL CHECK (StaffType IN ('Nurse', 'Technician', 'Admin', 'Receptionist', 'Pharmacist', 'Janitor', 'Security')),
    ShiftType VARCHAR(20) NOT NULL CHECK (ShiftType IN ('Morning', 'Afternoon', 'Night', 'Rotating')),
    CONSTRAINT FK_Staff_Employee FOREIGN KEY (EmployeeID) REFERENCES dbo.Employees(EmployeeID)
);
GO

-- Patients
CREATE TABLE dbo.Patients (
    PatientID INT IDENTITY(1,1) PRIMARY KEY,
    PatientCode VARCHAR(20) NOT NULL UNIQUE,
    FirstName VARCHAR(50) NOT NULL,
    LastName VARCHAR(50) NOT NULL,
    Gender CHAR(1) NOT NULL CHECK (Gender IN ('M', 'F')),
    DateOfBirth DATE NOT NULL,
    Phone VARCHAR(20),
    Email VARCHAR(100),
    Address VARCHAR(200),
    BloodGroup VARCHAR(5) CHECK (BloodGroup IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    RegistrationDate DATE NOT NULL DEFAULT GETDATE()
);
GO

-- Visits: CENTRAL FACT TABLE
-- All business activity flows through Visits
CREATE TABLE dbo.Visits (
    VisitID INT IDENTITY(1,1) PRIMARY KEY,
    PatientID INT NOT NULL,
    DoctorID INT NOT NULL,
    VisitDate DATETIME NOT NULL,
    Diagnosis VARCHAR(200),
    Symptoms VARCHAR(500),
    TreatmentNotes VARCHAR(500),
    FollowUpDate DATE,
    Status VARCHAR(20) NOT NULL DEFAULT 'Completed' CHECK (Status IN ('Completed', 'InProgress', 'Cancelled', 'Scheduled')),
    CONSTRAINT FK_Visits_Patient FOREIGN KEY (PatientID) REFERENCES dbo.Patients(PatientID),
    CONSTRAINT FK_Visits_Doctor FOREIGN KEY (DoctorID) REFERENCES dbo.Doctors(DoctorID)
);
GO

-- Bills: One Bill per Visit (UNIQUE on VisitID)
-- NO PatientID column — must go through Visits to reach Patient
CREATE TABLE dbo.Bills (
    BillID INT IDENTITY(1,1) PRIMARY KEY,
    VisitID INT NOT NULL UNIQUE, -- Enforces 1:1 with Visit
    BillDate DATE NOT NULL,
    ConsultationCharge DECIMAL(10,2) NOT NULL DEFAULT 0,
    MedicineCharge DECIMAL(10,2) NOT NULL DEFAULT 0,
    RoomCharge DECIMAL(10,2) NOT NULL DEFAULT 0,
    OtherCharge DECIMAL(10,2) NOT NULL DEFAULT 0,
    TotalAmount AS (ConsultationCharge + MedicineCharge + RoomCharge + OtherCharge) PERSISTED,
    PaymentStatus VARCHAR(20) NOT NULL DEFAULT 'Paid' CHECK (PaymentStatus IN ('Paid', 'Pending', 'Partial', 'Waived')),
    CONSTRAINT FK_Bills_Visit FOREIGN KEY (VisitID) REFERENCES dbo.Visits(VisitID)
);
GO

-- Medicines
CREATE TABLE dbo.Medicines (
    MedicineID INT IDENTITY(1,1) PRIMARY KEY,
    MedicineCode VARCHAR(20) NOT NULL UNIQUE,
    MedicineName VARCHAR(100) NOT NULL,
    Category VARCHAR(50) NOT NULL,
    Manufacturer VARCHAR(100),
    UnitPrice DECIMAL(10,2) NOT NULL,
    StockQuantity INT NOT NULL DEFAULT 0,
    ExpiryDate DATE
);
GO

-- Prescriptions: linked to Visit and Medicine
-- Patient medicine usage flows: Patients -> Visits -> Prescriptions -> Medicines
CREATE TABLE dbo.Prescriptions (
    PrescriptionID INT IDENTITY(1,1) PRIMARY KEY,
    VisitID INT NOT NULL,
    MedicineID INT NOT NULL,
    Quantity INT NOT NULL DEFAULT 1,
    Dosage VARCHAR(50),
    Frequency VARCHAR(50),
    DurationDays INT,
    Notes VARCHAR(200),
    CONSTRAINT FK_Prescriptions_Visit FOREIGN KEY (VisitID) REFERENCES dbo.Visits(VisitID),
    CONSTRAINT FK_Prescriptions_Medicine FOREIGN KEY (MedicineID) REFERENCES dbo.Medicines(MedicineID)
);
GO

-- EmployeeSalary
CREATE TABLE dbo.EmployeeSalary (
    SalaryID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL,
    SalaryMonth INT NOT NULL CHECK (SalaryMonth BETWEEN 1 AND 12),
    SalaryYear INT NOT NULL,
    BasicSalary DECIMAL(10,2) NOT NULL,
    Bonus DECIMAL(10,2) NOT NULL DEFAULT 0,
    Deduction DECIMAL(10,2) NOT NULL DEFAULT 0,
    NetSalary AS (BasicSalary + Bonus - Deduction) PERSISTED,
    PaymentDate DATE NOT NULL,
    CONSTRAINT FK_EmployeeSalary_Employee FOREIGN KEY (EmployeeID) REFERENCES dbo.Employees(EmployeeID),
    CONSTRAINT UQ_EmployeeSalary_Month UNIQUE (EmployeeID, SalaryMonth, SalaryYear)
);
GO

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IX_Employees_DepartmentID ON dbo.Employees(DepartmentID);
CREATE INDEX IX_Visits_PatientID ON dbo.Visits(PatientID);
CREATE INDEX IX_Visits_DoctorID ON dbo.Visits(DoctorID);
CREATE INDEX IX_Visits_VisitDate ON dbo.Visits(VisitDate);
CREATE INDEX IX_Bills_VisitID ON dbo.Bills(VisitID);
CREATE INDEX IX_Prescriptions_VisitID ON dbo.Prescriptions(VisitID);
CREATE INDEX IX_Prescriptions_MedicineID ON dbo.Prescriptions(MedicineID);
CREATE INDEX IX_EmployeeSalary_EmployeeID ON dbo.EmployeeSalary(EmployeeID);
CREATE INDEX IX_EmployeeSalary_YearMonth ON dbo.EmployeeSalary(SalaryYear, SalaryMonth);
CREATE INDEX IX_Patients_Name ON dbo.Patients(FirstName, LastName);
CREATE INDEX IX_Employees_Name ON dbo.Employees(FirstName, LastName);
GO

-- ============================================================
-- VIEWS
-- ============================================================

-- Patient Summary: total visits and total spent
CREATE VIEW dbo.vw_PatientSummary AS
SELECT
    p.PatientID,
    p.PatientCode,
    p.FirstName,
    p.LastName,
    COUNT(v.VisitID) AS TotalVisits,
    ISNULL(SUM(b.TotalAmount), 0) AS TotalSpent
FROM dbo.Patients p
LEFT JOIN dbo.Visits v ON v.PatientID = p.PatientID
LEFT JOIN dbo.Bills b ON b.VisitID = v.VisitID
GROUP BY p.PatientID, p.PatientCode, p.FirstName, p.LastName;
GO

-- Patient Billing: Patient -> Visit -> Doctor -> Bill
CREATE VIEW dbo.vw_PatientBilling AS
SELECT
    p.PatientID,
    p.FirstName AS PatientFirstName,
    p.LastName AS PatientLastName,
    v.VisitID,
    v.VisitDate,
    v.Diagnosis,
    e.FirstName AS DoctorFirstName,
    e.LastName AS DoctorLastName,
    d.Specialization,
    b.BillID,
    b.ConsultationCharge,
    b.MedicineCharge,
    b.RoomCharge,
    b.OtherCharge,
    b.TotalAmount,
    b.PaymentStatus
FROM dbo.Patients p
JOIN dbo.Visits v ON v.PatientID = p.PatientID
JOIN dbo.Doctors d ON d.DoctorID = v.DoctorID
JOIN dbo.Employees e ON e.EmployeeID = d.EmployeeID
JOIN dbo.Bills b ON b.VisitID = v.VisitID;
GO

-- Doctor Performance
CREATE VIEW dbo.vw_DoctorPerformance AS
SELECT
    d.DoctorID,
    e.FirstName AS DoctorFirstName,
    e.LastName AS DoctorLastName,
    d.Specialization,
    COUNT(DISTINCT v.PatientID) AS UniquePatients,
    COUNT(v.VisitID) AS TotalVisits,
    ISNULL(SUM(b.TotalAmount), 0) AS RevenueGenerated
FROM dbo.Doctors d
JOIN dbo.Employees e ON e.EmployeeID = d.EmployeeID
LEFT JOIN dbo.Visits v ON v.DoctorID = d.DoctorID
LEFT JOIN dbo.Bills b ON b.VisitID = v.VisitID
GROUP BY d.DoctorID, e.FirstName, e.LastName, d.Specialization;
GO

-- Medicine Usage
CREATE VIEW dbo.vw_MedicineUsage AS
SELECT
    m.MedicineID,
    m.MedicineCode,
    m.MedicineName,
    m.Category,
    COUNT(pr.PrescriptionID) AS TimesPrescribed,
    ISNULL(SUM(pr.Quantity), 0) AS QuantityPrescribed
FROM dbo.Medicines m
LEFT JOIN dbo.Prescriptions pr ON pr.MedicineID = m.MedicineID
GROUP BY m.MedicineID, m.MedicineCode, m.MedicineName, m.Category;
GO

-- Department Payroll
CREATE VIEW dbo.vw_DepartmentPayroll AS
SELECT
    dept.DepartmentID,
    dept.DepartmentCode,
    dept.DepartmentName,
    ISNULL(SUM(es.NetSalary), 0) AS TotalSalaryCost
FROM dbo.Departments dept
LEFT JOIN dbo.Employees emp ON emp.DepartmentID = dept.DepartmentID
LEFT JOIN dbo.EmployeeSalary es ON es.EmployeeID = emp.EmployeeID
GROUP BY dept.DepartmentID, dept.DepartmentCode, dept.DepartmentName;
GO

-- ============================================================
-- STORED PROCEDURES
-- ============================================================

CREATE PROCEDURE dbo.usp_GetPatientSummary
    @PatientFirstName VARCHAR(50) = NULL,
    @PatientLastName VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        p.PatientCode,
        p.FirstName,
        p.LastName,
        COUNT(v.VisitID) AS TotalVisits,
        ISNULL(SUM(b.TotalAmount), 0) AS TotalSpent
    FROM dbo.Patients p
    LEFT JOIN dbo.Visits v ON v.PatientID = p.PatientID
    LEFT JOIN dbo.Bills b ON b.VisitID = v.VisitID
    WHERE (@PatientFirstName IS NULL OR p.FirstName = @PatientFirstName)
      AND (@PatientLastName IS NULL OR p.LastName = @PatientLastName)
    GROUP BY p.PatientCode, p.FirstName, p.LastName;
END
GO

CREATE PROCEDURE dbo.usp_GetPatientVisitHistory
    @PatientFirstName VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        p.FirstName,
        p.LastName,
        v.VisitDate,
        v.Diagnosis,
        v.Symptoms,
        v.Status AS VisitStatus,
        e.FirstName AS DoctorFirstName,
        e.LastName AS DoctorLastName,
        d.Specialization
    FROM dbo.Patients p
    JOIN dbo.Visits v ON v.PatientID = p.PatientID
    JOIN dbo.Doctors d ON d.DoctorID = v.DoctorID
    JOIN dbo.Employees e ON e.EmployeeID = d.EmployeeID
    WHERE p.FirstName = @PatientFirstName
    ORDER BY v.VisitDate DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetPatientBillingHistory
    @PatientFirstName VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        p.FirstName,
        p.LastName,
        v.VisitDate,
        v.Diagnosis,
        b.ConsultationCharge,
        b.MedicineCharge,
        b.RoomCharge,
        b.OtherCharge,
        b.TotalAmount,
        b.PaymentStatus
    FROM dbo.Patients p
    JOIN dbo.Visits v ON v.PatientID = p.PatientID
    JOIN dbo.Bills b ON b.VisitID = v.VisitID
    WHERE p.FirstName = @PatientFirstName
    ORDER BY v.VisitDate DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetPatientSpendingPerVisit
    @PatientFirstName VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        p.FirstName,
        p.LastName,
        v.VisitDate,
        b.TotalAmount AS AmountPerVisit,
        SUM(b.TotalAmount) OVER (PARTITION BY p.PatientID) AS TotalSpentByPatient
    FROM dbo.Patients p
    JOIN dbo.Visits v ON v.PatientID = p.PatientID
    JOIN dbo.Bills b ON b.VisitID = v.VisitID
    WHERE p.FirstName = @PatientFirstName
    ORDER BY v.VisitDate;
END
GO

CREATE PROCEDURE dbo.usp_GetDoctorPerformance
    @DoctorFirstName VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        e.FirstName AS DoctorFirstName,
        e.LastName AS DoctorLastName,
        d.Specialization,
        COUNT(DISTINCT v.PatientID) AS UniquePatients,
        COUNT(v.VisitID) AS TotalVisits,
        ISNULL(SUM(b.TotalAmount), 0) AS RevenueGenerated
    FROM dbo.Doctors d
    JOIN dbo.Employees e ON e.EmployeeID = d.EmployeeID
    LEFT JOIN dbo.Visits v ON v.DoctorID = d.DoctorID
    LEFT JOIN dbo.Bills b ON b.VisitID = v.VisitID
    WHERE (@DoctorFirstName IS NULL OR e.FirstName = @DoctorFirstName)
    GROUP BY e.FirstName, e.LastName, d.Specialization
    ORDER BY RevenueGenerated DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetDoctorRevenue
    @DoctorFirstName VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        e.FirstName AS DoctorFirstName,
        e.LastName AS DoctorLastName,
        d.Specialization,
        d.ConsultationFee,
        ISNULL(SUM(b.TotalAmount), 0) AS TotalRevenue,
        ISNULL(SUM(b.ConsultationCharge), 0) AS ConsultationRevenue,
        ISNULL(SUM(b.MedicineCharge), 0) AS MedicineRevenue
    FROM dbo.Doctors d
    JOIN dbo.Employees e ON e.EmployeeID = d.EmployeeID
    LEFT JOIN dbo.Visits v ON v.DoctorID = d.DoctorID
    LEFT JOIN dbo.Bills b ON b.VisitID = v.VisitID
    WHERE (@DoctorFirstName IS NULL OR e.FirstName = @DoctorFirstName)
    GROUP BY e.FirstName, e.LastName, d.Specialization, d.ConsultationFee
    ORDER BY TotalRevenue DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetDoctorPatientCount
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        e.FirstName AS DoctorFirstName,
        e.LastName AS DoctorLastName,
        d.Specialization,
        COUNT(DISTINCT v.PatientID) AS UniquePatientCount
    FROM dbo.Doctors d
    JOIN dbo.Employees e ON e.EmployeeID = d.EmployeeID
    LEFT JOIN dbo.Visits v ON v.DoctorID = d.DoctorID
    GROUP BY e.FirstName, e.LastName, d.Specialization
    ORDER BY UniquePatientCount DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetTopSpendingPatients
    @TopN INT = 10
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@TopN)
        p.PatientCode,
        p.FirstName,
        p.LastName,
        COUNT(v.VisitID) AS TotalVisits,
        SUM(b.TotalAmount) AS TotalSpent
    FROM dbo.Patients p
    JOIN dbo.Visits v ON v.PatientID = p.PatientID
    JOIN dbo.Bills b ON b.VisitID = v.VisitID
    GROUP BY p.PatientCode, p.FirstName, p.LastName
    ORDER BY TotalSpent DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetMedicineUsage
    @MedicineName VARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        m.MedicineCode,
        m.MedicineName,
        m.Category,
        m.UnitPrice,
        COUNT(pr.PrescriptionID) AS TimesPrescribed,
        ISNULL(SUM(pr.Quantity), 0) AS TotalQuantityPrescribed
    FROM dbo.Medicines m
    LEFT JOIN dbo.Prescriptions pr ON pr.MedicineID = m.MedicineID
    WHERE (@MedicineName IS NULL OR m.MedicineName LIKE '%' + @MedicineName + '%')
    GROUP BY m.MedicineCode, m.MedicineName, m.Category, m.UnitPrice
    ORDER BY TimesPrescribed DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetMostPrescribedMedicines
    @TopN INT = 10
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@TopN)
        m.MedicineName,
        m.Category,
        m.Manufacturer,
        COUNT(pr.PrescriptionID) AS TimesPrescribed,
        SUM(pr.Quantity) AS TotalQuantity
    FROM dbo.Medicines m
    JOIN dbo.Prescriptions pr ON pr.MedicineID = m.MedicineID
    GROUP BY m.MedicineName, m.Category, m.Manufacturer
    ORDER BY TimesPrescribed DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetEmployeeSalaryHistory
    @EmployeeFirstName VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        e.FirstName,
        e.LastName,
        dept.DepartmentName,
        es.SalaryYear,
        es.SalaryMonth,
        es.BasicSalary,
        es.Bonus,
        es.Deduction,
        es.NetSalary,
        es.PaymentDate
    FROM dbo.Employees e
    JOIN dbo.Departments dept ON dept.DepartmentID = e.DepartmentID
    JOIN dbo.EmployeeSalary es ON es.EmployeeID = e.EmployeeID
    WHERE e.FirstName = @EmployeeFirstName
    ORDER BY es.SalaryYear DESC, es.SalaryMonth DESC;
END
GO

CREATE PROCEDURE dbo.usp_GetDepartmentPayroll
    @DepartmentName VARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        dept.DepartmentCode,
        dept.DepartmentName,
        COUNT(DISTINCT emp.EmployeeID) AS EmployeeCount,
        ISNULL(SUM(es.NetSalary), 0) AS TotalPayroll
    FROM dbo.Departments dept
    LEFT JOIN dbo.Employees emp ON emp.DepartmentID = dept.DepartmentID
    LEFT JOIN dbo.EmployeeSalary es ON es.EmployeeID = emp.EmployeeID
    WHERE (@DepartmentName IS NULL OR dept.DepartmentName LIKE '%' + @DepartmentName + '%')
    GROUP BY dept.DepartmentCode, dept.DepartmentName
    ORDER BY TotalPayroll DESC;
END
GO

-- ============================================================
-- SAMPLE DATA
-- ============================================================

-- 20 Departments
INSERT INTO dbo.Departments (DepartmentCode, DepartmentName) VALUES
('CARD', 'Cardiology'), ('NEUR', 'Neurology'), ('ORTH', 'Orthopedics'),
('PEDI', 'Pediatrics'), ('DERM', 'Dermatology'), ('ONCO', 'Oncology'),
('GAST', 'Gastroenterology'), ('PULM', 'Pulmonology'), ('ENDO', 'Endocrinology'),
('NEPH', 'Nephrology'), ('UROL', 'Urology'), ('OPHT', 'Ophthalmology'),
('ENT', 'ENT'), ('PSYC', 'Psychiatry'), ('RADI', 'Radiology'),
('ANES', 'Anesthesiology'), ('PATH', 'Pathology'), ('EMRG', 'Emergency Medicine'),
('GENM', 'General Medicine'), ('SURG', 'General Surgery');
GO

-- 150 Employees (50 will be doctors, 100 staff)
DECLARE @i INT = 1;
WHILE @i <= 150
BEGIN
    INSERT INTO dbo.Employees (EmployeeCode, DepartmentID, FirstName, LastName, Gender, DateOfBirth, HireDate, Email, Phone, Status)
    VALUES (
        'EMP' + RIGHT('000' + CAST(@i AS VARCHAR), 4),
        ((@i - 1) % 20) + 1,
        'EmpFirst' + CAST(@i AS VARCHAR),
        'EmpLast' + CAST(@i AS VARCHAR),
        CASE WHEN @i % 3 = 0 THEN 'F' ELSE 'M' END,
        DATEADD(YEAR, -(25 + (@i % 30)), GETDATE()),
        DATEADD(MONTH, -(@i * 3 % 120), GETDATE()),
        'emp' + CAST(@i AS VARCHAR) + '@hospital.com',
        '555-' + RIGHT('0000' + CAST(1000 + @i AS VARCHAR), 4),
        CASE WHEN @i % 20 = 0 THEN 'Inactive' WHEN @i % 15 = 0 THEN 'OnLeave' ELSE 'Active' END
    );
    SET @i = @i + 1;
END
GO

-- 50 Doctors (EmployeeID 1-50)
DECLARE @i INT = 1;
DECLARE @specs TABLE (id INT, spec VARCHAR(100));
INSERT INTO @specs VALUES
(1,'Cardiologist'),(2,'Neurologist'),(3,'Orthopedic Surgeon'),(4,'Pediatrician'),
(5,'Dermatologist'),(6,'Oncologist'),(7,'Gastroenterologist'),(8,'Pulmonologist'),
(9,'Endocrinologist'),(10,'Nephrologist');

WHILE @i <= 50
BEGIN
    INSERT INTO dbo.Doctors (EmployeeID, Specialization, Qualification, LicenseNumber, ConsultationFee)
    VALUES (
        @i,
        CASE ((@i - 1) % 10)
            WHEN 0 THEN 'Cardiologist' WHEN 1 THEN 'Neurologist'
            WHEN 2 THEN 'Orthopedic Surgeon' WHEN 3 THEN 'Pediatrician'
            WHEN 4 THEN 'Dermatologist' WHEN 5 THEN 'Oncologist'
            WHEN 6 THEN 'Gastroenterologist' WHEN 7 THEN 'Pulmonologist'
            WHEN 8 THEN 'Endocrinologist' ELSE 'Nephrologist'
        END,
        CASE WHEN @i % 3 = 0 THEN 'MD, DM' WHEN @i % 2 = 0 THEN 'MBBS, MS' ELSE 'MBBS, MD' END,
        'LIC' + RIGHT('00000' + CAST(10000 + @i AS VARCHAR), 6),
        500 + (@i * 50 % 2000)
    );
    SET @i = @i + 1;
END
GO

-- 100 Staff (EmployeeID 51-150)
DECLARE @i INT = 51;
WHILE @i <= 150
BEGIN
    INSERT INTO dbo.Staff (EmployeeID, StaffType, ShiftType)
    VALUES (
        @i,
        CASE ((@i - 51) % 7)
            WHEN 0 THEN 'Nurse' WHEN 1 THEN 'Technician' WHEN 2 THEN 'Admin'
            WHEN 3 THEN 'Receptionist' WHEN 4 THEN 'Pharmacist'
            WHEN 5 THEN 'Janitor' ELSE 'Security'
        END,
        CASE ((@i - 51) % 4)
            WHEN 0 THEN 'Morning' WHEN 1 THEN 'Afternoon'
            WHEN 2 THEN 'Night' ELSE 'Rotating'
        END
    );
    SET @i = @i + 1;
END
GO

-- 200 Patients
DECLARE @i INT = 1;
WHILE @i <= 200
BEGIN
    INSERT INTO dbo.Patients (PatientCode, FirstName, LastName, Gender, DateOfBirth, Phone, Email, Address, BloodGroup, RegistrationDate)
    VALUES (
        'PAT' + RIGHT('0000' + CAST(@i AS VARCHAR), 4),
        'PatientFirst' + CAST(@i AS VARCHAR),
        'PatientLast' + CAST(@i AS VARCHAR),
        CASE WHEN @i % 2 = 0 THEN 'F' ELSE 'M' END,
        DATEADD(YEAR, -(20 + (@i % 60)), GETDATE()),
        '555-' + RIGHT('0000' + CAST(2000 + @i AS VARCHAR), 4),
        'patient' + CAST(@i AS VARCHAR) + '@email.com',
        CAST(@i * 10 AS VARCHAR) + ' Medical Street, City ' + CAST((@i % 10) + 1 AS VARCHAR),
        CASE (@i % 8)
            WHEN 0 THEN 'A+' WHEN 1 THEN 'A-' WHEN 2 THEN 'B+'
            WHEN 3 THEN 'B-' WHEN 4 THEN 'AB+' WHEN 5 THEN 'AB-'
            WHEN 6 THEN 'O+' ELSE 'O-'
        END,
        DATEADD(DAY, -(@i * 2 % 730), GETDATE())
    );
    SET @i = @i + 1;
END
GO

-- 100 Medicines
DECLARE @i INT = 1;
WHILE @i <= 100
BEGIN
    INSERT INTO dbo.Medicines (MedicineCode, MedicineName, Category, Manufacturer, UnitPrice, StockQuantity, ExpiryDate)
    VALUES (
        'MED' + RIGHT('000' + CAST(@i AS VARCHAR), 4),
        CASE ((@i - 1) % 10)
            WHEN 0 THEN 'Amoxicillin ' WHEN 1 THEN 'Ibuprofen '
            WHEN 2 THEN 'Metformin ' WHEN 3 THEN 'Atorvastatin '
            WHEN 4 THEN 'Omeprazole ' WHEN 5 THEN 'Losartan '
            WHEN 6 THEN 'Amlodipine ' WHEN 7 THEN 'Metoprolol '
            WHEN 8 THEN 'Cetirizine ' ELSE 'Paracetamol '
        END + CAST(@i AS VARCHAR) + 'mg',
        CASE ((@i - 1) % 5)
            WHEN 0 THEN 'Antibiotic' WHEN 1 THEN 'Painkiller'
            WHEN 2 THEN 'Antidiabetic' WHEN 3 THEN 'Cardiovascular'
            ELSE 'Gastrointestinal'
        END,
        CASE ((@i - 1) % 4)
            WHEN 0 THEN 'PharmaCorp' WHEN 1 THEN 'MediLife'
            WHEN 2 THEN 'HealthGen' ELSE 'BioMed'
        END,
        10.00 + (@i * 7 % 500),
        50 + (@i * 13 % 500),
        DATEADD(MONTH, 6 + (@i % 24), GETDATE())
    );
    SET @i = @i + 1;
END
GO

-- 1000 Visits (distributed across patients and doctors)
DECLARE @i INT = 1;
DECLARE @diagnoses TABLE (id INT, diag VARCHAR(200));
INSERT INTO @diagnoses VALUES
(1,'Hypertension'),(2,'Type 2 Diabetes'),(3,'Upper Respiratory Infection'),
(4,'Lower Back Pain'),(5,'Migraine'),(6,'Allergic Rhinitis'),
(7,'Gastritis'),(8,'Bronchitis'),(9,'Skin Rash'),(10,'Anxiety Disorder'),
(11,'Fracture'),(12,'Anemia'),(13,'Urinary Tract Infection'),
(14,'Asthma'),(15,'Arthritis');

WHILE @i <= 1000
BEGIN
    INSERT INTO dbo.Visits (PatientID, DoctorID, VisitDate, Diagnosis, Symptoms, TreatmentNotes, FollowUpDate, Status)
    VALUES (
        ((@i - 1) % 200) + 1,
        ((@i - 1) % 50) + 1,
        DATEADD(DAY, -(@i % 730), GETDATE()),
        CASE ((@i - 1) % 15)
            WHEN 0 THEN 'Hypertension' WHEN 1 THEN 'Type 2 Diabetes'
            WHEN 2 THEN 'Upper Respiratory Infection' WHEN 3 THEN 'Lower Back Pain'
            WHEN 4 THEN 'Migraine' WHEN 5 THEN 'Allergic Rhinitis'
            WHEN 6 THEN 'Gastritis' WHEN 7 THEN 'Bronchitis'
            WHEN 8 THEN 'Skin Rash' WHEN 9 THEN 'Anxiety Disorder'
            WHEN 10 THEN 'Fracture' WHEN 11 THEN 'Anemia'
            WHEN 12 THEN 'Urinary Tract Infection' WHEN 13 THEN 'Asthma'
            ELSE 'Arthritis'
        END,
        'Reported symptoms for visit ' + CAST(@i AS VARCHAR),
        'Treatment administered for visit ' + CAST(@i AS VARCHAR),
        CASE WHEN @i % 3 = 0 THEN DATEADD(DAY, 14, DATEADD(DAY, -(@i % 730), GETDATE())) ELSE NULL END,
        CASE WHEN @i % 50 = 0 THEN 'Cancelled' WHEN @i % 30 = 0 THEN 'Scheduled' ELSE 'Completed' END
    );
    SET @i = @i + 1;
END
GO

-- 1000 Bills (one per visit, enforced by UNIQUE constraint)
DECLARE @i INT = 1;
WHILE @i <= 1000
BEGIN
    INSERT INTO dbo.Bills (VisitID, BillDate, ConsultationCharge, MedicineCharge, RoomCharge, OtherCharge, PaymentStatus)
    VALUES (
        @i,
        DATEADD(DAY, -(@i % 730), GETDATE()),
        500 + (@i * 7 % 2000),
        200 + (@i * 13 % 1500),
        CASE WHEN @i % 5 = 0 THEN 1000 + (@i * 3 % 3000) ELSE 0 END,
        50 + (@i * 11 % 500),
        CASE WHEN @i % 10 = 0 THEN 'Pending' WHEN @i % 20 = 0 THEN 'Partial' ELSE 'Paid' END
    );
    SET @i = @i + 1;
END
GO

-- 3000 Prescriptions (distributed across visits and medicines)
DECLARE @i INT = 1;
WHILE @i <= 3000
BEGIN
    INSERT INTO dbo.Prescriptions (VisitID, MedicineID, Quantity, Dosage, Frequency, DurationDays, Notes)
    VALUES (
        ((@i - 1) % 1000) + 1,
        ((@i - 1) % 100) + 1,
        1 + (@i % 5),
        CASE (@i % 3) WHEN 0 THEN '500mg' WHEN 1 THEN '250mg' ELSE '100mg' END,
        CASE (@i % 4) WHEN 0 THEN 'Once daily' WHEN 1 THEN 'Twice daily' WHEN 2 THEN 'Three times daily' ELSE 'As needed' END,
        CASE (@i % 3) WHEN 0 THEN 7 WHEN 1 THEN 14 ELSE 30 END,
        'Take as prescribed'
    );
    SET @i = @i + 1;
END
GO

-- 24 months salary history for all 150 employees
DECLARE @emp INT = 1;
WHILE @emp <= 150
BEGIN
    DECLARE @month INT = 1;
    WHILE @month <= 24
    BEGIN
        DECLARE @year INT = CASE WHEN @month <= 12 THEN 2025 ELSE 2024 END;
        DECLARE @mon INT = CASE WHEN @month <= 12 THEN @month ELSE @month - 12 END;
        DECLARE @baseSalary DECIMAL(10,2) = 30000 + (@emp * 500 % 70000);
        
        INSERT INTO dbo.EmployeeSalary (EmployeeID, SalaryMonth, SalaryYear, BasicSalary, Bonus, Deduction, PaymentDate)
        VALUES (
            @emp,
            @mon,
            @year,
            @baseSalary,
            CASE WHEN @mon = 12 THEN @baseSalary * 0.10 ELSE @emp * 100 % 5000 END,
            @baseSalary * 0.05 + (@emp % 1000),
            DATEFROMPARTS(@year, @mon, 28)
        );
        SET @month = @month + 1;
    END
    SET @emp = @emp + 1;
END
GO

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT 'Departments' AS TableName, COUNT(*) AS RowCount FROM dbo.Departments
UNION ALL SELECT 'Employees', COUNT(*) FROM dbo.Employees
UNION ALL SELECT 'Doctors', COUNT(*) FROM dbo.Doctors
UNION ALL SELECT 'Staff', COUNT(*) FROM dbo.Staff
UNION ALL SELECT 'Patients', COUNT(*) FROM dbo.Patients
UNION ALL SELECT 'Medicines', COUNT(*) FROM dbo.Medicines
UNION ALL SELECT 'Visits', COUNT(*) FROM dbo.Visits
UNION ALL SELECT 'Bills', COUNT(*) FROM dbo.Bills
UNION ALL SELECT 'Prescriptions', COUNT(*) FROM dbo.Prescriptions
UNION ALL SELECT 'EmployeeSalary', COUNT(*) FROM dbo.EmployeeSalary;
GO

PRINT '============================================================';
PRINT 'HospitalAnalyticsDB created successfully.';
PRINT 'Schema is optimized for Text-to-SQL with single join paths:';
PRINT '  Patient billing:   Patients -> Visits -> Bills';
PRINT '  Doctor revenue:    Doctors -> Visits -> Bills';
PRINT '  Patient medicines: Patients -> Visits -> Prescriptions -> Medicines';
PRINT '  Employee salary:   Employees -> EmployeeSalary';
PRINT '  Department payroll: Departments -> Employees -> EmployeeSalary';
PRINT '============================================================';
GO
