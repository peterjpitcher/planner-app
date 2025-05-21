'use client';

import React, { createContext, useState, useContext } from 'react';

const TargetProjectContext = createContext();

export const useTargetProject = () => useContext(TargetProjectContext);

export const TargetProjectProvider = ({ children }) => {
  const [targetProjectId, setTargetProjectId] = useState(null);

  return (
    <TargetProjectContext.Provider value={{ targetProjectId, setTargetProjectId }}>
      {children}
    </TargetProjectContext.Provider>
  );
}; 